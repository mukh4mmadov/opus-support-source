alter table public.bookings add column instant boolean not null default false;

create table public.instant_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default public.app_now(),
  decided_at timestamptz
);
create index instant_requests_support_idx on public.instant_requests (support_id, status);
create index instant_requests_student_idx on public.instant_requests (student_id, created_at);
alter table public.instant_requests enable row level security;
revoke all on public.instant_requests from anon, authenticated;

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('instant_enabled', 'true', 'bool', 'Features', 'Lesson now', 'Students at the center can ask a support teacher who is free right now for a lesson that starts at once.', false, 45),
  ('instant_expire_minutes', '5', 'int', 'Booking', 'Lesson now request expires after (minutes)', 'If the support teacher does not answer in time, the request ends.', false, 95);

insert into public.notification_templates (type, title, body, description) values
  ('instant_request', 'Lesson now request', '{{student}} asks for a lesson now. Topic: {{topic}}. Accept only if they are next to you.', 'Support teacher, when a student asks for a lesson now'),
  ('instant_accepted', 'Your lesson starts now', '{{support}} accepted. Your lesson starts now. When they press Came, scan the code.', 'Student, when a support teacher accepts a lesson now'),
  ('instant_declined', 'Lesson now not possible', '{{support}} cannot take a lesson now. Try another support teacher.', 'Student, when a lesson now is declined');

create function public.instant_live(r public.instant_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.status = 'pending'
    and r.created_at > public.app_now() - public.setting_int('instant_expire_minutes') * interval '1 minute'
$$;

create function public.instant_check_student(p_student uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.setting_bool('instant_enabled') then
    raise exception 'INSTANT_DISABLED';
  end if;
  if (public.active_ban(p_student)).id is not null then
    raise exception 'STUDENT_BANNED';
  end if;
  if public.rebook_from(p_student) is not null then
    raise exception 'REBOOK_LATER';
  end if;
  if exists (
    select 1 from public.bookings b
    where b.student_id = p_student and b.status = 'booked'
      and b.starts_at < p_end and b.ends_at > p_start
  ) then
    raise exception 'INSTANT_BUSY';
  end if;
end $$;

create function public.instant_supports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := date_trunc('minute', public.app_now());
  v_end timestamptz := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  if not public.setting_bool('instant_enabled') then
    return '[]';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', public.full_name(p), 'rating', public.rating_of(p.id)
    ) order by p.first_name, p.last_name), '[]')
    from public.profiles p
    where p.role = 'support' and p.is_active and public.support_is_free(p.id, v_start, v_end)
  );
end $$;

create function public.instant_request(p_support uuid, p_topic text default '') returns public.instant_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_start timestamptz := date_trunc('minute', public.app_now());
  v_end timestamptz := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
  v_topic text := left(btrim(coalesce(p_topic, '')), public.setting_int('topic_max_length'));
  r public.instant_requests;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  perform 1 from public.profiles where id = v_me for update;
  perform public.instant_check_student(v_me, v_start, v_end);
  if exists (select 1 from public.instant_requests x where x.student_id = v_me and public.instant_live(x)) then
    raise exception 'INSTANT_PENDING';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_support and p.role = 'support' and p.is_active)
    or not public.support_is_free(p_support, v_start, v_end) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  insert into public.instant_requests (student_id, support_id, topic)
  values (v_me, p_support, v_topic) returning * into r;
  perform public.notify(p_support, 'instant_request', jsonb_build_object(
    'student', public.name_of(v_me), 'topic', coalesce(nullif(v_topic, ''), '-')), '/');
  return r;
end $$;

create function public.instant_inbox() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_role public.user_role := public.my_role();
begin
  if v_role = 'support' then
    return (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'student_name', public.name_of(r.student_id), 'topic', r.topic, 'created_at', r.created_at
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
        'expires_at', r.created_at + public.setting_int('instant_expire_minutes') * interval '1 minute'
      )
      from public.instant_requests r
      where r.student_id = v_me
        and coalesce(r.decided_at, r.created_at) > public.app_now() - interval '10 minutes'
      order by r.created_at desc limit 1
    );
  end if;
  raise exception 'FORBIDDEN';
end $$;

create function public.instant_answer(p_request uuid, p_accept boolean) returns public.instant_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_start timestamptz := date_trunc('minute', v_now);
  v_end timestamptz := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
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

create function public.instant_cancel(p_request uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.instant_requests set status = 'cancelled', decided_at = public.app_now()
  where id = p_request and student_id = auth.uid() and status = 'pending';
end $$;

create or replace function public.booking_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'student_id', b.student_id,
    'support_id', b.support_id,
    'student_name', public.name_of(b.student_id),
    'support_name', public.name_of(b.support_id),
    'lesson_date', b.lesson_date,
    'starts_at', b.starts_at,
    'ends_at', b.ends_at,
    'topic', b.topic,
    'status', b.status,
    'cancel_reason', b.cancel_reason,
    'marked_at', b.marked_at,
    'auto_marked', b.auto_marked and b.status = 'no_show',
    'excuse_reason', b.excuse_reason,
    'checked_in_at', b.checked_in_at,
    'instant', b.instant,
    'can_cancel', b.status = 'needs_transfer' or (b.status = 'booked'
      and public.local_today() <= b.lesson_date - public.setting_int('cancel_days_before')),
    'no_show_from', b.starts_at
      + public.setting_int('no_show_after_minutes') * interval '1 minute',
    'mark_until', b.ends_at
      + public.setting_int('mark_after_minutes') * interval '1 minute'
  )
$$;

create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'login', p.login,
    'first_name', p.first_name, 'last_name', p.last_name,
    'chat_enabled', public.setting_bool('chat_enabled'),
    'reviews_enabled', public.setting_bool('reviews_enabled'),
    'leaderboard_enabled', public.setting_bool('leaderboard_enabled'),
    'instant_enabled', public.setting_bool('instant_enabled'),
    'unread', (select count(*) from public.notifications n
               where n.user_id = p.id and n.read_at is null),
    'rules', jsonb_build_object(
      'min_days', public.setting_int('booking_min_days_ahead'),
      'max_days', public.setting_int('booking_max_days_ahead'),
      'cancel_days', public.setting_int('cancel_days_before'),
      'wait_days', public.setting_int('rebook_wait_days'),
      'close_days', public.setting_int('close_min_days_before'),
      'no_show_minutes', public.setting_int('no_show_after_minutes'),
      'mark_minutes', public.setting_int('mark_after_minutes'),
      'alert_minutes', public.setting_int('unmarked_alert_minutes'),
      'auto_no_show', public.setting_bool('auto_no_show_enabled'),
      'qr_required', public.setting_bool('qr_checkin_enabled'),
      'excused_limit', public.setting_int('excused_per_month'),
      'warnings', public.setting_int('warnings_before_ban'),
      'ban_hours', public.setting_int('ban_hours'),
      'reset_days', public.setting_int('strike_reset_days'),
      'instant_minutes', public.setting_int('instant_expire_minutes')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

revoke all on function
  public.instant_live(public.instant_requests),
  public.instant_check_student(uuid, timestamptz, timestamptz),
  public.instant_supports(),
  public.instant_request(uuid, text),
  public.instant_inbox(),
  public.instant_answer(uuid, boolean),
  public.instant_cancel(uuid)
from public, anon, authenticated;

grant execute on function
  public.instant_supports(),
  public.instant_request(uuid, text),
  public.instant_inbox(),
  public.instant_answer(uuid, boolean),
  public.instant_cancel(uuid)
to authenticated;
