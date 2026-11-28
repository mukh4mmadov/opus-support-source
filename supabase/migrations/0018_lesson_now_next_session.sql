alter table public.instant_requests add column starts_at timestamptz;

create function public.instant_slot(p_support uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select min(s.starts_at)
  from public.slots_for(p_support, public.local_today()) s
  where s.starts_at >= date_trunc('minute', public.app_now())
    and s.starts_at < date_trunc('minute', public.app_now())
      + public.setting_int('lesson_minutes') * interval '1 minute'
$$;

create or replace function public.instant_supports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_minutes int := public.setting_int('lesson_minutes');
  v_now timestamptz := date_trunc('minute', public.app_now());
  v_list jsonb := '[]';
  v_reason text;
  v_start timestamptz;
  p public.profiles;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  for p in
    select * from public.profiles x
    where x.role = 'support' and x.is_active and x.present_on = public.local_today()
    order by x.first_name, x.last_name
  loop
    v_start := public.instant_slot(p.id);
    continue when v_start is null
      or not public.support_is_free(p.id, v_start, v_start + v_minutes * interval '1 minute');
    begin
      perform public.instant_check_student(auth.uid(), v_start, v_start + v_minutes * interval '1 minute');
    exception when raise_exception then
      v_reason := coalesce(v_reason, sqlerrm);
      continue;
    end;
    v_list := v_list || jsonb_build_object(
      'id', p.id, 'name', public.full_name(p), 'rating', public.rating_of(p.id), 'starts_at', v_start);
  end loop;
  if jsonb_array_length(v_list) > 0 then
    return jsonb_build_object('supports', v_list, 'reason', null);
  end if;
  if v_reason is null then
    begin
      perform public.instant_check_student(auth.uid(), v_now, v_now + v_minutes * interval '1 minute');
    exception when raise_exception then
      v_reason := sqlerrm;
    end;
  end if;
  return jsonb_build_object('supports', '[]'::jsonb, 'reason', v_reason);
end $$;

create or replace function public.instant_request(p_support uuid, p_topic text default '') returns public.instant_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_start timestamptz := public.instant_slot(p_support);
  v_end timestamptz := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
  v_topic text := left(btrim(coalesce(p_topic, '')), public.setting_int('topic_max_length'));
  r public.instant_requests;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  if v_start is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  perform 1 from public.profiles where id = v_me for update;
  perform public.instant_check_student(v_me, v_start, v_end);
  if exists (select 1 from public.instant_requests x where x.student_id = v_me and public.instant_live(x)) then
    raise exception 'INSTANT_PENDING';
  end if;
  if not exists (
      select 1 from public.profiles p
      where p.id = p_support and p.role = 'support' and p.is_active and p.present_on = public.local_today())
    or not public.support_is_free(p_support, v_start, v_end) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  insert into public.instant_requests (student_id, support_id, topic, starts_at)
  values (v_me, p_support, v_topic, v_start) returning * into r;
  perform public.notify(p_support, 'instant_request', jsonb_build_object(
    'student', public.name_of(v_me), 'topic', coalesce(nullif(v_topic, ''), '-'),
    'time', public.fmt_time(v_start)), '/');
  return r;
end $$;

create or replace function public.instant_inbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_role public.user_role := public.my_role();
  v_wait interval := public.setting_int('instant_expire_minutes') * interval '1 minute';
begin
  if v_role = 'support' then
    return (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'student_name', public.name_of(r.student_id), 'topic', r.topic,
        'created_at', r.created_at, 'starts_at', r.starts_at,
        'seconds_left', greatest(0, ceil(extract(epoch from r.created_at + v_wait - public.app_now())))::int
      ) order by r.created_at), '[]')
      from public.instant_requests r
      where r.support_id = v_me and public.instant_live(r)
    );
  end if;
  if v_role = 'student' then
    return (
      select jsonb_build_object(
        'id', r.id, 'support_name', public.name_of(r.support_id),
        'status', case when r.status = 'pending' and not public.instant_live(r) then 'expired' else r.status end,
        'expires_at', r.created_at + v_wait,
        'starts_at', r.starts_at,
        'seconds_left', greatest(0, ceil(extract(epoch from r.created_at + v_wait - public.app_now())))::int
      )
      from public.instant_requests r
      where r.student_id = v_me
        and coalesce(r.decided_at, r.created_at) > public.app_now() - interval '10 minutes'
      order by r.created_at desc limit 1
    );
  end if;
  raise exception 'FORBIDDEN';
end $$;

create or replace function public.instant_answer(p_request uuid, p_accept boolean) returns public.instant_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_start timestamptz;
  v_end timestamptz;
  r public.instant_requests;
  other public.instant_requests;
  b public.bookings;
begin
  select * into r from public.instant_requests where id = p_request for update;
  if not found or r.support_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if not public.instant_live(r) then
    raise exception 'INSTANT_EXPIRED';
  end if;

  if not p_accept then
    update public.instant_requests set status = 'declined', decided_at = v_now where id = r.id returning * into r;
    perform public.notify(r.student_id, 'instant_declined', jsonb_build_object('support', public.name_of(r.support_id)), '/book');
    return r;
  end if;

  v_start := coalesce(r.starts_at, date_trunc('minute', v_now));
  v_end := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
  perform public.instant_check_student(r.student_id, v_start, v_end);
  if not public.support_is_free(r.support_id, v_start, v_end) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  begin
    insert into public.bookings (student_id, support_id, lesson_date, starts_at, ends_at, topic, created_by, instant)
    values (r.student_id, r.support_id, (v_start at time zone public.center_tz())::date, v_start, v_end,
            r.topic, auth.uid(), true)
    returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  update public.instant_requests set status = 'accepted', decided_at = v_now, booking_id = b.id
  where id = r.id returning * into r;

  for other in
    update public.instant_requests set status = 'declined', decided_at = v_now
    where support_id = r.support_id and id <> r.id and status = 'pending'
    returning *
  loop
    perform public.notify(other.student_id, 'instant_declined', jsonb_build_object('support', public.name_of(other.support_id)), '/book');
  end loop;

  perform public.notify(r.student_id, 'instant_accepted', public.booking_vars(b), '/');
  perform public.log_audit('booking.instant', 'booking', b.id::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id)));
  return r;
end $$;

update public.notification_templates
set body = '{{student}} asks for a lesson at {{time}}. Topic: {{topic}}. Accept only if they are next to you.'
where type = 'instant_request'
  and body = '{{student}} asks for a lesson now. Topic: {{topic}}. Accept only if they are next to you.';
update public.notification_templates set title = 'Lesson now accepted'
where type = 'instant_accepted' and title = 'Your lesson starts now';
update public.notification_templates
set body = '{{support}} accepted. Your lesson starts at {{time}}. When they press Came, scan the code.'
where type = 'instant_accepted'
  and body = '{{support}} accepted. Your lesson starts now. When they press Came, scan the code.';
update public.settings
set help = 'Students at the center can ask a support teacher who is free for a lesson at their nearest session.'
where key = 'instant_enabled'
  and help = 'Students at the center can ask a support teacher who is free right now for a lesson that starts at once.';

revoke all on function public.instant_slot(uuid) from public, anon, authenticated;
