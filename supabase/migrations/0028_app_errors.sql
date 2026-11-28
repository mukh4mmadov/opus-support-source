create table public.app_errors (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  kind text not null check (kind in ('server', 'crash', 'network')),
  message text not null,
  fn text not null default '',
  path text not null default '',
  details jsonb not null default '{}',
  user_id uuid references public.profiles (id) on delete set null,
  role text not null default '',
  repeats int not null default 1,
  happened_at timestamptz not null,
  created_at timestamptz not null default public.app_now(),
  last_at timestamptz not null default public.app_now(),
  fixed_at timestamptz
);
create index app_errors_fingerprint_idx on public.app_errors (fingerprint, id desc);
create index app_errors_user_idx on public.app_errors (user_id, created_at);
create index app_errors_last_idx on public.app_errors (last_at);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

insert into public.notification_templates (type, title, body, description) values
  ('app_error', 'New error in the app', '{{name}} ({{role}}): {{message}}', 'Developer, when a new kind of error happens');

create function public.purge_app_errors() returns void
language sql security definer set search_path = '' as $$
  delete from public.app_errors where last_at < public.app_now() - interval '30 days'
$$;

create function public.error_fingerprint(p_kind text, p_fn text, p_path text, p_message text)
returns text
language sql immutable set search_path = '' as $$
  select md5(p_kind || '|' ||
    case
      when p_kind = 'crash' then regexp_replace(p_path, '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', ':id', 'gi')
      else p_fn
    end || '|' ||
    case
      when p_kind = 'network' then ''
      else regexp_replace(
        regexp_replace(p_message, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'),
        '[0-9]+', '#', 'g')
    end)
$$;

create function public.report_client_errors(p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_now timestamptz := public.app_now();
  v_item jsonb;
  v_kind text;
  v_message text;
  v_fn text;
  v_path text;
  v_details jsonb;
  v_repeats int;
  v_at timestamptz;
  v_fp text;
  v_new boolean;
begin
  select role::text into v_role from public.profiles where id = v_user;
  if v_role is null then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    return;
  end if;
  if (select count(*) from public.app_errors
      where user_id = v_user and created_at > v_now - interval '1 hour') >= 30 then
    return;
  end if;
  perform public.purge_app_errors();

  for v_item in select value from jsonb_array_elements(p_items) limit 20 loop
    continue when jsonb_typeof(v_item) <> 'object';
    v_kind := v_item->>'kind';
    continue when v_kind is null or v_kind not in ('server', 'crash', 'network');
    v_message := left(coalesce(nullif(btrim(v_item->>'message'), ''), '(no message)'), 500);
    v_fn := left(coalesce(v_item->>'fn', ''), 80);
    v_path := left(coalesce(v_item->>'path', ''), 200);
    v_details := case when jsonb_typeof(v_item->'details') = 'object' then v_item->'details' else '{}' end;
    if length(v_details::text) > 8000 then
      v_details := jsonb_build_object('cut', left(v_details::text, 8000));
    end if;
    v_repeats := case when (v_item->>'repeats') ~ '^[0-9]{1,4}$'
      then greatest((v_item->>'repeats')::int, 1) else 1 end;
    v_at := null;
    if (v_item->>'at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
      begin
        v_at := (v_item->>'at')::timestamptz;
      exception when others then
        v_at := null;
      end;
    end if;
    v_at := coalesce(v_at, v_now);
    v_fp := public.error_fingerprint(v_kind, v_fn, v_path, v_message);

    update public.app_errors
    set repeats = repeats + v_repeats, last_at = v_now, details = v_details
    where id = (
      select e.id from public.app_errors e
      where e.fingerprint = v_fp and e.user_id = v_user and e.fixed_at is null
        and e.last_at > v_now - interval '10 minutes'
      order by e.id desc limit 1
    );
    continue when found;

    v_new := not exists (
      select 1 from public.app_errors e where e.fingerprint = v_fp and e.fixed_at is null
    );
    insert into public.app_errors
      (fingerprint, kind, message, fn, path, details, user_id, role, repeats, happened_at, created_at, last_at)
    values
      (v_fp, v_kind, v_message, v_fn, v_path, v_details, v_user, v_role, v_repeats, v_at, v_now, v_now);

    if v_new and v_kind <> 'network' then
      perform public.notify(p.id, 'app_error', jsonb_build_object(
        'name', public.name_of(v_user), 'role', v_role, 'message', left(v_message, 120)
      ), '/admin/errors')
      from public.profiles p where p.role = 'admin' and p.is_active;
    end if;
  end loop;
end $$;

create function public.admin_errors(p_fixed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.purge_app_errors();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'fingerprint', g.fingerprint, 'kind', l.kind, 'message', l.message, 'fn', l.fn, 'path', l.path,
      'times', g.times, 'people', g.people, 'first_at', g.first_at, 'last_at', g.last_at,
      'fixed_at', g.fixed_at, 'cases', c.cases
    ) order by g.last_at desc), '[]')
    from (
      select e.fingerprint, sum(e.repeats)::int as times, count(distinct e.user_id)::int as people,
        min(e.created_at) as first_at, max(e.last_at) as last_at, max(e.fixed_at) as fixed_at
      from public.app_errors e
      where (e.fixed_at is null) <> p_fixed
      group by e.fingerprint
      order by max(e.last_at) desc
      limit 200
    ) g
    cross join lateral (
      select e.kind, e.message, e.fn, e.path from public.app_errors e
      where e.fingerprint = g.fingerprint and (e.fixed_at is null) <> p_fixed
      order by e.id desc limit 1
    ) l
    cross join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'at', e.happened_at, 'received_at', e.created_at, 'last_at', e.last_at,
        'repeats', e.repeats, 'user_id', e.user_id,
        'name', coalesce(public.name_of(e.user_id), 'Deleted account'), 'login', p.login,
        'role', e.role, 'path', e.path, 'message', e.message, 'details', e.details
      ) order by e.id desc) as cases
      from (
        select * from public.app_errors x
        where x.fingerprint = g.fingerprint and (x.fixed_at is null) <> p_fixed
        order by x.id desc limit 25
      ) e
      left join public.profiles p on p.id = e.user_id
    ) c
  );
end $$;

create function public.admin_error_count() returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select count(distinct fingerprint) from public.app_errors
    where fixed_at is null and kind <> 'network'
  );
end $$;

create function public.admin_error_fixed(p_fingerprint text, p_fixed boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_message text;
begin
  perform public.require_admin();
  select message into v_message from public.app_errors
  where fingerprint = p_fingerprint order by id desc limit 1;
  if v_message is null then
    raise exception 'ERROR_NOT_FOUND';
  end if;
  if p_fixed then
    update public.app_errors set fixed_at = public.app_now()
    where fingerprint = p_fingerprint and fixed_at is null;
  else
    update public.app_errors set fixed_at = null
    where fingerprint = p_fingerprint and fixed_at is not null;
  end if;
  perform public.log_audit(case when p_fixed then 'error.fixed' else 'error.reopen' end,
    'error', p_fingerprint, jsonb_build_object('message', left(v_message, 120)));
end $$;

revoke all on function
  public.purge_app_errors(),
  public.error_fingerprint(text, text, text, text),
  public.report_client_errors(jsonb),
  public.admin_errors(boolean),
  public.admin_error_count(),
  public.admin_error_fixed(text, boolean)
from public, anon, authenticated;

grant execute on function
  public.report_client_errors(jsonb),
  public.admin_errors(boolean),
  public.admin_error_count(),
  public.admin_error_fixed(text, boolean)
to authenticated;
