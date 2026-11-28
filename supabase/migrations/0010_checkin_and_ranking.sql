create table public.checkin_codes (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  primary key (booking_id, code)
);
alter table public.checkin_codes enable row level security;
revoke all on public.checkin_codes from anon, authenticated;

alter table public.bookings
  add column checked_in_at timestamptz,
  add column checkin_tries int not null default 0;

alter table public.schedule_closures add column same_day boolean not null default false;

alter table public.profiles add column hidden_from_top boolean not null default false;

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  reply text not null default '',
  answered_at timestamptz,
  created_at timestamptz not null default public.app_now()
);
alter table public.complaints enable row level security;
revoke all on public.complaints from anon, authenticated;

update public.settings
set value = '0', label = 'Support closes days ahead (days)',
    help = '0 lets a support teacher close today, until the lesson starts. Each same-day closing is reported to the admin.'
where key = 'close_min_days_before';

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('qr_checkin_enabled', 'true', 'bool', 'Attendance', 'Came needs a QR scan', 'The support teacher shows a code and the student scans it. Off: the support teacher marks Came alone.', false, 11),
  ('leaderboard_enabled', 'true', 'bool', 'Features', 'Center ranking', 'Everyone sees who attended the most lessons.', false, 40);

update public.notification_templates
set body = '{{support}} has not confirmed your {{time}} lesson. Ask them to press Came and scan the code before {{deadline}}. If you do not, it counts as missed and you can get a penalty.'
where type = 'unmarked_student';

insert into public.notification_templates (type, title, body, description) values
  ('same_day_closure', 'Closed on the day', '{{support}} closed {{date}} on the day itself. Reason: {{reason}}. Lessons affected: {{count}}.', 'Admin, when a support teacher closes today'),
  ('complaint_new', 'New complaint', '{{student}} wrote about the lesson on {{date}} at {{time}} with {{support}}: {{body}}', 'Admin, when a student sends a complaint'),
  ('complaint_answered', 'The center answered', 'About your lesson on {{date}} at {{time}}: {{reply}}', 'Student, when the admin answers a complaint');

drop function public.mark_attendance(uuid, public.booking_status, text);

create function public.same_day_pass(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.bookings b
    where b.student_id = p_student and b.lesson_date = public.local_today()
      and b.status = 'cancelled'
      and b.cancel_reason in ('day_closed', 'transfer_declined', 'transfer_expired', 'admin')
  )
$$;

create or replace function public.booking_days() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d::date,
    'free', (
      select count(*)
      from public.profiles p
      cross join lateral public.slots_for(p.id, d::date) s
      where p.role = 'support' and p.is_active and s.is_free
    )
  ) order by d), '[]')
  from generate_series(
    public.local_today() + case when public.same_day_pass(auth.uid()) then 0
      else public.setting_int('booking_min_days_ahead') end,
    public.local_today() + public.setting_int('booking_max_days_ahead'),
    interval '1 day'
  ) d
  where auth.uid() is not null
$$;

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
      'reset_days', public.setting_int('strike_reset_days')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.student_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_active public.bookings;
  v_ban public.bans := public.active_ban(v_me);
  v_review public.bookings;
  v_checkin public.bookings;
  v_options jsonb := '[]';
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_active from public.bookings b
  where b.student_id = v_me and b.status in ('booked', 'needs_transfer')
  order by b.starts_at limit 1;

  if v_active.status = 'needs_transfer' then
    select coalesce(jsonb_agg(jsonb_build_object('support_id', o.support_id, 'name', o.name)), '[]')
    into v_options from public.transfer_options(v_active.id) o;
  end if;

  if public.setting_bool('reviews_enabled') then
    select * into v_review from public.bookings b
    where b.student_id = v_me and b.status = 'attended'
      and not exists (select 1 from public.reviews r where r.booking_id = b.id)
    order by b.starts_at desc limit 1;
  end if;

  select * into v_checkin from public.bookings b
  where b.student_id = v_me and b.status in ('booked', 'no_show', 'excused') and not b.auto_marked
    and b.starts_at <= public.app_now()
    and b.ends_at + public.setting_int('mark_after_minutes') * interval '1 minute' >= public.app_now()
  order by b.starts_at desc limit 1;

  return jsonb_build_object(
    'active', case when v_active.id is null then null else public.booking_json(v_active) end,
    'checkin_lesson', case when v_checkin.id is null or not public.setting_bool('qr_checkin_enabled')
      then null else public.booking_json(v_checkin) end,
    'support_phone', case when v_active.status = 'booked' then
      (select nullif(p.phone, '') from public.profiles p where p.id = v_active.support_id) end,
    'transfer_options', v_options,
    'ban', case when v_ban.id is null then null
      else jsonb_build_object('ends_at', v_ban.ends_at, 'reason', v_ban.reason) end,
    'rebook_from', public.rebook_from(v_me),
    'same_day_pass', public.same_day_pass(v_me),
    'strikes', public.active_strikes(v_me),
    'warnings_before_ban', public.setting_int('warnings_before_ban'),
    'pending_review', case when v_review.id is null then null else public.booking_json(v_review) end,
    'announcements', public.announcements_for('student'),
    'rules', jsonb_build_object(
      'min_days', public.setting_int('booking_min_days_ahead'),
      'max_days', public.setting_int('booking_max_days_ahead'),
      'lesson_minutes', public.setting_int('lesson_minutes'),
      'topic_required', public.setting_bool('topic_required'),
      'topic_max_length', public.setting_int('topic_max_length'),
      'cancel_days_before', public.setting_int('cancel_days_before')
    ),
    'today', public.local_today()
  );
end $$;

create or replace function public.book_lesson(
  p_support uuid, p_starts_at timestamptz, p_topic text default '', p_student uuid default null
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_admin boolean := public.is_admin();
  v_student uuid;
  v_date date := (p_starts_at at time zone public.center_tz())::date;
  v_today date := public.local_today();
  v_topic text := btrim(coalesce(p_topic, ''));
  v_end timestamptz;
  v_booking public.bookings;
begin
  if v_admin and p_student is not null then
    v_student := p_student;
  elsif public.my_role() = 'student' then
    v_student := v_me;
  else
    raise exception 'FORBIDDEN';
  end if;

  perform 1 from public.profiles
    where id = v_student and role = 'student' and is_active for update;
  if not found then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  if public.setting_bool('topic_required') and v_topic = '' and not v_admin then
    raise exception 'TOPIC_REQUIRED';
  end if;
  if length(v_topic) > public.setting_int('topic_max_length') then
    raise exception 'TOPIC_TOO_LONG';
  end if;

  if not v_admin then
    if (public.active_ban(v_student)).id is not null then
      raise exception 'STUDENT_BANNED';
    end if;
    if public.rebook_from(v_student) is not null then
      raise exception 'REBOOK_LATER';
    end if;
    if (v_date < v_today + public.setting_int('booking_min_days_ahead')
        and not (v_date = v_today and public.same_day_pass(v_student)))
      or v_date > v_today + public.setting_int('booking_max_days_ahead') then
      raise exception 'DATE_OUT_OF_RANGE';
    end if;
    if (select count(*) from public.bookings b
        where b.student_id = v_student and b.status in ('booked', 'needs_transfer'))
        >= public.setting_int('max_active_bookings') then
      raise exception 'ACTIVE_BOOKING_EXISTS';
    end if;
    if (select count(*) from public.bookings b
        where b.student_id = v_student and b.lesson_date = v_date
          and b.status not in ('cancelled', 'support_absent'))
        >= public.setting_int('max_bookings_per_day') then
      raise exception 'DAILY_LIMIT_REACHED';
    end if;
  end if;

  select s.ends_at into v_end
  from public.slots_for(p_support, v_date) s
  where s.starts_at = p_starts_at and s.is_free;
  if v_end is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    insert into public.bookings (
      student_id, support_id, lesson_date, starts_at, ends_at, topic, created_by
    ) values (v_student, p_support, v_date, p_starts_at, v_end, v_topic, v_me)
    returning * into v_booking;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  perform public.notify(v_student, 'booking_confirmed', public.booking_vars(v_booking), '/');
  perform public.notify(p_support, 'booking_new', public.booking_vars(v_booking), '/');
  if v_admin then
    perform public.log_audit('booking.create', 'booking', v_booking.id::text,
      jsonb_build_object('student', v_student, 'support', p_support));
  end if;
  return v_booking;
end $$;

create or replace function public.cancel_booking(p_booking uuid, p_reason text default '')
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not v_admin and b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status not in ('booked', 'needs_transfer') then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if not v_admin and b.status = 'booked'
    and public.local_today() > b.lesson_date - public.setting_int('cancel_days_before') then
    raise exception 'CANCEL_TOO_LATE';
  end if;

  update public.bookings
  set status = 'cancelled',
      cancel_reason = coalesce(nullif(btrim(p_reason), ''),
        case when v_admin then 'admin'
             when b.status = 'needs_transfer' then 'transfer_declined'
             else 'student' end),
      rebook_from = case when not v_admin and b.status = 'booked'
        then public.local_today() + public.setting_int('rebook_wait_days') end
  where id = p_booking
  returning * into b;

  if v_admin then
    perform public.notify(b.student_id, 'booking_cancelled', public.booking_vars(b), '/');
    perform public.log_audit('booking.cancel', 'booking', b.id::text,
      jsonb_build_object('reason', b.cancel_reason));
  end if;
  perform public.notify(b.support_id, 'booking_cancelled', public.booking_vars(b), '/');
  return b;
end $$;

create function public.mark_attendance(
  p_booking uuid, p_status public.booking_status, p_reason text default ''
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  v_now timestamptz := public.app_now();
  v_reason text := left(btrim(coalesce(p_reason, '')), 300);
  v_limit int := public.setting_int('excused_per_month');
  v_used int;
  b public.bookings;
  v_old public.booking_status;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  v_old := b.status;

  select count(*) into v_used from public.bookings x
  where x.student_id = b.student_id and x.status = 'excused' and x.id <> b.id
    and x.marked_at > v_now - interval '30 days';

  if v_admin then
    if p_status not in ('attended', 'no_show', 'support_absent', 'excused', 'unmarked') then
      raise exception 'INVALID_STATUS';
    end if;
    if v_old in ('cancelled', 'needs_transfer') then
      raise exception 'BOOKING_NOT_ACTIVE';
    end if;
  else
    if b.support_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
    if p_status not in ('attended', 'no_show', 'excused') then
      raise exception 'INVALID_STATUS';
    end if;
    if p_status = 'attended' and public.setting_bool('qr_checkin_enabled') then
      raise exception 'QR_REQUIRED';
    end if;
    if v_old not in ('booked', 'attended', 'no_show', 'excused')
      or (v_old <> 'booked' and b.marked_by is distinct from auth.uid()) then
      raise exception 'ALREADY_MARKED';
    end if;
    if v_now > b.ends_at + public.setting_int('mark_after_minutes') * interval '1 minute' then
      raise exception 'MARKING_CLOSED';
    end if;
    if p_status = 'excused' then
      if public.local_today() <> b.lesson_date then
        raise exception 'EXCUSE_NOT_TODAY';
      end if;
      if v_reason = '' then
        raise exception 'EXCUSE_REASON_REQUIRED';
      end if;
      if v_used >= v_limit then
        raise exception 'EXCUSE_LIMIT_REACHED';
      end if;
    else
      if v_now < b.starts_at then
        raise exception 'LESSON_NOT_STARTED';
      end if;
      if p_status = 'no_show' and v_now < b.starts_at
          + public.setting_int('no_show_after_minutes') * interval '1 minute' then
        raise exception 'NO_SHOW_TOO_EARLY';
      end if;
    end if;
  end if;

  if v_old = p_status then
    return b;
  end if;

  update public.bookings
  set status = p_status, marked_by = auth.uid(), marked_at = v_now,
      checked_in_at = case when p_status = 'attended' then checked_in_at end,
      excuse_reason = case when p_status = 'excused' then v_reason else '' end,
      rebook_from = case when p_status = 'excused' and not v_admin
        then public.local_today() + public.setting_int('rebook_wait_days') end
  where id = p_booking
  returning * into b;

  if v_old = 'no_show' then
    perform public.revoke_strike(p_booking);
  end if;
  if p_status = 'no_show' then
    perform public.apply_strike(b);
  end if;
  if p_status = 'attended' and public.setting_bool('reviews_enabled') then
    perform public.notify(b.student_id, 'review_request', public.booking_vars(b), '/history');
  end if;
  if p_status = 'excused' then
    perform public.notify(b.student_id, 'lesson_excused', public.booking_vars(b) || jsonb_build_object(
      'reason', coalesce(nullif(v_reason, ''), 'decided by the center'),
      'used', v_used + 1, 'limit', v_limit), '/history');
    if not v_admin then
      perform public.notify(p.id, 'excused_alert', public.booking_vars(b)
        || jsonb_build_object('reason', v_reason), '/admin/bookings')
      from public.profiles p where p.role = 'admin' and p.is_active;
    end if;
  end if;
  perform public.log_audit('booking.mark', 'booking', b.id::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id),
    'from', v_old, 'to', p_status, 'reason', v_reason));
  return b;
end $$;

create function public.checkin_code(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_code text := lpad(floor(random() * 1000000)::int::text, 6, '0');
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if b.support_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status not in ('booked', 'no_show', 'excused') or b.auto_marked
    or (b.status <> 'booked' and b.marked_by is distinct from auth.uid()) then
    raise exception 'ALREADY_MARKED';
  end if;
  if v_now < b.starts_at then
    raise exception 'LESSON_NOT_STARTED';
  end if;
  if v_now > b.ends_at + public.setting_int('mark_after_minutes') * interval '1 minute' then
    raise exception 'MARKING_CLOSED';
  end if;

  delete from public.checkin_codes where booking_id = p_booking and expires_at < v_now;
  insert into public.checkin_codes (booking_id, code, expires_at)
  values (p_booking, v_code, v_now + interval '45 seconds')
  on conflict (booking_id, code) do update set expires_at = excluded.expires_at;
  return jsonb_build_object('code', v_code);
end $$;

create function public.check_in(p_booking uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  b public.bookings;
  v_old public.booking_status;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status = 'attended' then
    return 'ok';
  end if;
  if b.status not in ('booked', 'no_show', 'excused') or b.auto_marked then
    raise exception 'ALREADY_MARKED';
  end if;
  if v_now < b.starts_at then
    raise exception 'LESSON_NOT_STARTED';
  end if;
  if v_now > b.ends_at + public.setting_int('mark_after_minutes') * interval '1 minute' then
    raise exception 'MARKING_CLOSED';
  end if;
  if b.checkin_tries >= 20 then
    raise exception 'CHECKIN_LOCKED';
  end if;

  if not exists (
    select 1 from public.checkin_codes c
    where c.booking_id = p_booking and c.code = btrim(coalesce(p_code, '')) and c.expires_at >= v_now
  ) then
    update public.bookings set checkin_tries = checkin_tries + 1 where id = p_booking;
    return 'wrong';
  end if;

  v_old := b.status;
  update public.bookings
  set status = 'attended', marked_by = auth.uid(), marked_at = v_now, checked_in_at = v_now,
      excuse_reason = '', rebook_from = null
  where id = p_booking
  returning * into b;
  delete from public.checkin_codes where booking_id = p_booking;

  if v_old = 'no_show' then
    perform public.revoke_strike(p_booking);
  end if;
  if public.setting_bool('reviews_enabled') then
    perform public.notify(b.student_id, 'review_request', public.booking_vars(b), '/history');
  end if;
  perform public.log_audit('booking.check_in', 'booking', b.id::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id), 'from', v_old));
  return 'ok';
end $$;

create or replace function public.close_day(
  p_support uuid, p_date date, p_reason text default '',
  p_from time default null, p_to time default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  v_same_day boolean := not v_admin and p_date = public.local_today();
  v_hit int;
begin
  if not v_admin and (p_support is null or p_support is distinct from auth.uid()
      or public.my_role() is distinct from 'support') then
    raise exception 'FORBIDDEN';
  end if;
  if p_date < public.local_today() then
    raise exception 'DATE_IN_PAST';
  end if;
  if not v_admin
    and p_date < public.local_today() + public.setting_int('close_min_days_before') then
    raise exception 'CLOSE_TOO_LATE';
  end if;
  if (p_from is null) <> (p_to is null) or p_to <= p_from then
    raise exception 'HOURS_INVALID';
  end if;
  if not v_admin and exists (
    select 1 from public.bookings x
    where x.support_id = p_support and x.lesson_date = p_date and x.status = 'booked'
      and x.starts_at <= public.app_now()
      and (p_from is null or (
        p_from < (x.ends_at at time zone public.center_tz())::time
        and p_to > (x.starts_at at time zone public.center_tz())::time
      ))
  ) then
    raise exception 'LESSON_ALREADY_STARTED';
  end if;

  if p_from is not null then
    insert into public.schedule_closures (support_id, closed_on, start_time, end_time, reason, created_by, same_day)
    values (p_support, p_date, p_from, p_to, coalesce(p_reason, ''), auth.uid(), v_same_day);
  elsif p_support is null then
    insert into public.schedule_closures (support_id, closed_on, reason, created_by)
    values (null, p_date, coalesce(p_reason, ''), auth.uid())
    on conflict (closed_on) where support_id is null and start_time is null do nothing;
  else
    insert into public.schedule_closures (support_id, closed_on, reason, created_by, same_day)
    values (p_support, p_date, coalesce(p_reason, ''), auth.uid(), v_same_day)
    on conflict (support_id, closed_on) where support_id is not null and start_time is null do nothing;
  end if;

  perform public.log_audit('day.close', 'closure', p_date::text,
    jsonb_build_object('support', p_support, 'reason', p_reason, 'from', p_from, 'to', p_to,
      'same_day', v_same_day));
  v_hit := public.apply_closure(p_support, p_date, p_from, p_to);

  if v_same_day then
    perform public.notify(p.id, 'same_day_closure', jsonb_build_object(
      'support', public.name_of(p_support), 'date', to_char(p_date, 'DD Mon'),
      'reason', coalesce(nullif(btrim(p_reason), ''), 'not given'), 'count', v_hit), '/admin/days')
    from public.profiles p where p.role = 'admin' and p.is_active;
  end if;
  return v_hit;
end $$;

create or replace function public.attendance_counts(p_user uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attended', count(*) filter (where b.status = 'attended'),
    'no_show', count(*) filter (where b.status = 'no_show'),
    'excused', count(*) filter (where b.status = 'excused'),
    'cancelled', count(*) filter (where b.status = 'cancelled'),
    'support_absent', count(*) filter (where b.status = 'support_absent'),
    'unmarked', count(*) filter (where b.status = 'unmarked'),
    'forgot', count(*) filter (where b.auto_marked and b.support_id = p_user),
    'closed_same_day', (
      select count(*) from public.audit_log a
      where a.action = 'day.close' and a.details ->> 'same_day' = 'true'
        and a.details ->> 'support' = p_user::text
        and (p_from is null or a.entity_id::date >= p_from)
        and (p_to is null or a.entity_id::date <= p_to)
    )
  )
  from public.bookings b
  where p_user in (b.student_id, b.support_id)
    and (p_from is null or b.lesson_date >= p_from)
    and (p_to is null or b.lesson_date <= p_to)
$$;

create function public.attendance_series(p_user uuid, p_unit text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_step interval;
  v_now timestamp := public.local_today()::timestamp;
begin
  if p_unit not in ('week', 'month') then
    raise exception 'INVALID_PERIOD';
  end if;
  v_step := ('1 ' || p_unit)::interval;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'start', d::date,
      'attended', (select count(*) from public.bookings b where p_user in (b.student_id, b.support_id)
        and b.status = 'attended' and b.lesson_date >= d::date and b.lesson_date < (d + v_step)::date),
      'no_show', (select count(*) from public.bookings b where p_user in (b.student_id, b.support_id)
        and b.status = 'no_show' and b.lesson_date >= d::date and b.lesson_date < (d + v_step)::date),
      'excused', (select count(*) from public.bookings b where p_user in (b.student_id, b.support_id)
        and b.status = 'excused' and b.lesson_date >= d::date and b.lesson_date < (d + v_step)::date)
    ) order by d), '[]')
    from generate_series(date_trunc(p_unit, v_now) - 11 * v_step, date_trunc(p_unit, v_now), v_step) d
  );
end $$;

create function public.my_attendance_series(p_unit text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.attendance_series(auth.uid(), p_unit) where auth.uid() is not null
$$;

create function public.admin_attendance_series(p_user uuid, p_unit text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return public.attendance_series(p_user, p_unit);
end $$;

create or replace function public.my_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.booking_json(b) || jsonb_build_object(
      'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment)
                 from public.reviews r where r.booking_id = b.id),
      'complaint', (select jsonb_build_object('body', c.body, 'reply', c.reply)
                    from public.complaints c
                    where c.booking_id = b.id and c.student_id = auth.uid())
    ) order by b.starts_at desc), '[]')
  from public.bookings b
  where auth.uid() in (b.student_id, b.support_id)
$$;

create function public.send_complaint(p_booking uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := left(btrim(coalesce(p_body, '')), 1000);
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if v_body = '' then
    raise exception 'COMPLAINT_EMPTY';
  end if;
  insert into public.complaints (booking_id, student_id, body)
  values (b.id, b.student_id, v_body)
  on conflict (booking_id) do nothing;
  if not found then
    raise exception 'COMPLAINT_EXISTS';
  end if;
  perform public.notify(p.id, 'complaint_new', public.booking_vars(b)
    || jsonb_build_object('body', v_body), '/admin/complaints')
  from public.profiles p where p.role = 'admin' and p.is_active;
end $$;

create function public.admin_complaints(p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'body', t.body, 'reply', t.reply, 'answered_at', t.answered_at,
      'created_at', t.created_at, 'booking', public.booking_json(b)
    ) order by t.answered_at is not null, t.created_at desc), '[]')
    from (
      select * from public.complaints c
      order by c.answered_at is not null, c.created_at desc limit p_limit
    ) t
    join public.bookings b on b.id = t.booking_id
  );
end $$;

create function public.admin_answer_complaint(p_complaint uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reply text := left(btrim(coalesce(p_reply, '')), 1000);
  c public.complaints;
  b public.bookings;
begin
  perform public.require_admin();
  if v_reply = '' then
    raise exception 'COMPLAINT_EMPTY';
  end if;
  update public.complaints set reply = v_reply, answered_at = public.app_now()
  where id = p_complaint returning * into c;
  if not found then
    raise exception 'COMPLAINT_NOT_FOUND';
  end if;
  select * into b from public.bookings where id = c.booking_id;
  perform public.notify(c.student_id, 'complaint_answered', public.booking_vars(b)
    || jsonb_build_object('reply', v_reply), '/history');
  perform public.log_audit('complaint.answer', 'complaint', c.id::text,
    jsonb_build_object('student', public.name_of(c.student_id)));
end $$;

create function public.leaderboard(p_period text default 'month') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := case when p_period = 'month'
    then date_trunc('month', public.local_today()::timestamp)::date end;
begin
  if not public.setting_bool('leaderboard_enabled') then
    raise exception 'LEADERBOARD_DISABLED';
  end if;
  return (
    with counted as (
      select b.student_id, count(*)::int as lessons
      from public.bookings b
      join public.profiles p on p.id = b.student_id and p.is_active and not p.hidden_from_top
      where b.status = 'attended' and (v_from is null or b.lesson_date >= v_from)
      group by b.student_id
    ), ranked as (
      select student_id, lessons, public.name_of(student_id) as name,
        rank() over (order by lessons desc)::int as place
      from counted
    )
    select jsonb_build_object(
      'top', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'place', t.place, 'name', t.name, 'lessons', t.lessons, 'is_me', t.student_id = auth.uid()
        ) order by t.place, t.name), '[]')
        from (select * from ranked order by place, name limit 50) t
      ),
      'me', (select jsonb_build_object('place', place, 'lessons', lessons)
             from ranked where student_id = auth.uid())
    )
  );
end $$;

create or replace function public.admin_month_report(p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.lessons desc, t.name), '[]')
    from (
      select
        public.full_name(p) as name,
        count(b.id) filter (where b.status = 'attended') as lessons,
        round(coalesce(sum(extract(epoch from b.ends_at - b.starts_at) / 3600)
          filter (where b.status = 'attended'), 0), 1) as hours,
        count(b.id) filter (where b.status = 'no_show') as no_shows,
        count(b.id) filter (where b.status = 'excused') as excused,
        count(b.id) filter (where b.auto_marked) as forgot,
        count(b.id) filter (where b.status = 'support_absent') as absent,
        count(b.id) filter (where b.status = 'unmarked') as unmarked,
        (select count(*) from public.schedule_closures c
         where c.support_id = p.id and c.closed_on between v_from and v_to) as closed_days,
        (select count(*) from public.audit_log a
         where a.action = 'day.close' and a.details ->> 'same_day' = 'true'
           and a.details ->> 'support' = p.id::text
           and a.entity_id::date between v_from and v_to) as closed_same_day
      from public.profiles p
      left join public.bookings b
        on b.support_id = p.id and b.lesson_date between v_from and v_to
      where p.role = 'support'
      group by p.id
    ) t
  );
end $$;

revoke all on function
  public.same_day_pass(uuid),
  public.attendance_series(uuid, text),
  public.mark_attendance(uuid, public.booking_status, text),
  public.checkin_code(uuid),
  public.check_in(uuid, text),
  public.my_attendance_series(text),
  public.admin_attendance_series(uuid, text),
  public.send_complaint(uuid, text),
  public.admin_complaints(int),
  public.admin_answer_complaint(uuid, text),
  public.leaderboard(text)
from public, anon, authenticated;

grant execute on function
  public.mark_attendance(uuid, public.booking_status, text),
  public.checkin_code(uuid),
  public.check_in(uuid, text),
  public.my_attendance_series(text),
  public.admin_attendance_series(uuid, text),
  public.send_complaint(uuid, text),
  public.admin_complaints(int),
  public.admin_answer_complaint(uuid, text),
  public.leaderboard(text)
to authenticated;
