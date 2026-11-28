alter table public.profiles add column phone text not null default '';

alter table public.bookings
  add column auto_marked boolean not null default false,
  add column excuse_reason text not null default '',
  add column rebook_from date,
  add column reminded_unmarked_at timestamptz;

delete from public.settings where key = 'reschedule_enabled';
delete from public.notification_templates where type = 'lesson_rescheduled';

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('rebook_wait_days', '1', 'int', 'Booking', 'Wait after giving up a lesson (days)', 'After a student cancels or is excused, booking opens this many days later. 1 means tomorrow, 0 turns it off.', false, 85),
  ('mark_after_minutes', '10', 'int', 'Attendance', 'Marking closes after the lesson (minutes)', 'A 14:00 lesson of 30 minutes can be marked until 14:40. After that only the admin can change it.', false, 12),
  ('unmarked_alert_minutes', '15', 'int', 'Attendance', 'Unmarked warning (minutes after start)', 'If the lesson is still unmarked, both the support teacher and the student are warned.', false, 14),
  ('auto_no_show_enabled', 'true', 'bool', 'Attendance', 'Automatic no-show', 'At the deadline an unmarked lesson becomes a no-show and the student gets the penalty. Off: it stays Not marked with no penalty.', false, 16),
  ('excused_per_month', '2', 'int', 'Attendance', 'Excused lessons per student (30 days)', 'A support teacher cannot excuse more than this. The admin can.', false, 18);

insert into public.notification_templates (type, title, body, description) values
  ('unmarked_support', 'Mark this lesson now', 'Your lesson with {{student}} at {{time}} is not marked yet. Mark it before {{deadline}}, or {{student}} gets a penalty automatically.', 'Support teacher, when the lesson is still unmarked after it started'),
  ('unmarked_student', 'Your lesson is not marked yet', '{{support}} has not marked your {{time}} lesson. If it stays unmarked at {{deadline}}, it counts as missed and you can get a penalty. Remind your support teacher now.', 'Student, when the lesson is still unmarked after it started'),
  ('auto_no_show_support', 'Lesson marked as missed', 'You did not mark the lesson with {{student}} on {{date}} at {{time}}. It was marked as missed automatically and the student got a penalty. This is recorded on your account.', 'Support teacher, when the deadline passes with no mark'),
  ('lesson_excused', 'Lesson excused', '{{support}} excused your lesson on {{date}} at {{time}}. Reason: {{reason}}. There is no penalty. Excused lessons used: {{used}} of {{limit}}.', 'Student, when a lesson is marked excused'),
  ('excused_alert', 'Lesson excused', '{{support}} excused {{student}} for {{date}} at {{time}}. Reason: {{reason}}.', 'Admin, each time a support teacher excuses a lesson'),
  ('warning_removed', 'Warning removed', 'The center removed a warning from your account.', 'Student, when the admin removes a warning');

drop function public.reschedule_booking(uuid, uuid, timestamptz);
drop function public.mark_attendance(uuid, public.booking_status);
drop function public.admin_update_user(uuid, text, text, int, text, boolean);

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
    'auto_marked', b.auto_marked,
    'excuse_reason', b.excuse_reason,
    'can_cancel', b.status = 'needs_transfer' or (b.status = 'booked'
      and public.local_today() <= b.lesson_date - public.setting_int('cancel_days_before')),
    'no_show_from', b.starts_at
      + public.setting_int('no_show_after_minutes') * interval '1 minute',
    'mark_until', b.ends_at
      + public.setting_int('mark_after_minutes') * interval '1 minute'
  )
$$;

create or replace function public.booking_options() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'waitlist_enabled', public.setting_bool('waitlist_enabled'),
    'favorites', (select coalesce(jsonb_agg(f.support_id), '[]')
                  from public.favorite_supports f where f.student_id = auth.uid())
  )
  where auth.uid() is not null
$$;

create or replace function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'login', p.login,
    'first_name', p.first_name, 'last_name', p.last_name,
    'chat_enabled', public.setting_bool('chat_enabled'),
    'reviews_enabled', public.setting_bool('reviews_enabled'),
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
      'excused_limit', public.setting_int('excused_per_month'),
      'warnings', public.setting_int('warnings_before_ban'),
      'ban_hours', public.setting_int('ban_hours'),
      'reset_days', public.setting_int('strike_reset_days')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create function public.rebook_from(p_student uuid) returns date
language sql stable security definer set search_path = '' as $$
  select max(b.rebook_from) from public.bookings b
  where b.student_id = p_student and b.rebook_from > public.local_today()
$$;

create or replace function public.student_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_active public.bookings;
  v_ban public.bans := public.active_ban(v_me);
  v_review public.bookings;
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

  return jsonb_build_object(
    'active', case when v_active.id is null then null else public.booking_json(v_active) end,
    'support_phone', case when v_active.status = 'booked' then
      (select nullif(p.phone, '') from public.profiles p where p.id = v_active.support_id) end,
    'transfer_options', v_options,
    'ban', case when v_ban.id is null then null
      else jsonb_build_object('ends_at', v_ban.ends_at, 'reason', v_ban.reason) end,
    'rebook_from', public.rebook_from(v_me),
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

create or replace function public.support_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_today date := public.local_today();
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'today', v_today,
    'now', public.app_now(),
    'lessons_today', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at), '[]')
      from public.bookings b
      where b.support_id = v_me and b.lesson_date = v_today and b.status <> 'cancelled'
    ),
    'upcoming', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at), '[]')
      from public.bookings b
      where b.support_id = v_me and b.lesson_date > v_today and b.status = 'booked'
    ),
    'closures', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'closed_on', c.closed_on, 'reason', c.reason,
        'start_time', to_char(c.start_time, 'HH24:MI'),
        'end_time', to_char(c.end_time, 'HH24:MI')
      ) order by c.closed_on, c.start_time), '[]')
      from public.schedule_closures c
      where c.support_id = v_me and c.closed_on >= v_today
    ),
    'close_from', v_today + public.setting_int('close_min_days_before'),
    'lessons_this_month', (
      select count(*) from public.bookings b
      where b.support_id = v_me and b.status = 'attended'
        and date_trunc('month', b.lesson_date) = date_trunc('month', v_today)
    ),
    'schedule', public.schedule_of(v_me),
    'rating', public.rating_of(v_me),
    'announcements', public.announcements_for('support')
  );
end $$;

create or replace function public.my_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.booking_json(b) || jsonb_build_object(
      'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment)
                 from public.reviews r where r.booking_id = b.id)
    ) order by b.starts_at desc), '[]')
  from public.bookings b
  where auth.uid() in (b.student_id, b.support_id)
$$;

create function public.attendance_counts(p_user uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attended', count(*) filter (where b.status = 'attended'),
    'no_show', count(*) filter (where b.status = 'no_show'),
    'excused', count(*) filter (where b.status = 'excused'),
    'cancelled', count(*) filter (where b.status = 'cancelled'),
    'support_absent', count(*) filter (where b.status = 'support_absent'),
    'unmarked', count(*) filter (where b.status = 'unmarked'),
    'forgot', count(*) filter (where b.auto_marked and b.support_id = p_user)
  )
  from public.bookings b
  where p_user in (b.student_id, b.support_id)
    and (p_from is null or b.lesson_date >= p_from)
    and (p_to is null or b.lesson_date <= p_to)
$$;

create function public.attendance_summary(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with d as (select public.local_today()::timestamp as today)
  select jsonb_build_object(
    'week', public.attendance_counts(p_user, date_trunc('week', d.today)::date,
      (date_trunc('week', d.today) + interval '6 days')::date),
    'month', public.attendance_counts(p_user, date_trunc('month', d.today)::date,
      (date_trunc('month', d.today) + interval '1 month - 1 day')::date),
    'year', public.attendance_counts(p_user, date_trunc('year', d.today)::date,
      (date_trunc('year', d.today) + interval '1 year - 1 day')::date),
    'all', public.attendance_counts(p_user, null, null)
  )
  from d
$$;

create function public.my_attendance() returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.attendance_summary(auth.uid()) where auth.uid() is not null
$$;

create function public.admin_attendance(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return public.attendance_summary(p_user);
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
    if v_date < v_today + public.setting_int('booking_min_days_ahead')
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
        case when v_admin then 'admin' else 'student' end),
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

create function public.recount_strikes(p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.penalties;
  v_lifted int;
begin
  for p in
    select * from public.penalties x
    where x.student_id = p_student and x.revoked_at is null
      and x.kind = 'ban' and x.booking_id is not null
    order by x.created_at
  loop
    if (select count(*) from public.penalties y
        where y.student_id = p_student and y.revoked_at is null
          and y.created_at < p.created_at
          and y.created_at > p.created_at
            - public.setting_int('strike_reset_days') * interval '1 day')
        < public.setting_int('warnings_before_ban') then
      update public.penalties set kind = 'warning' where id = p.id;
      update public.bans set lifted_at = public.app_now(), lifted_by = auth.uid()
      where penalty_id = p.id and lifted_at is null and ends_at > public.app_now();
      get diagnostics v_lifted = row_count;
      if v_lifted > 0 then
        perform public.notify(p_student, 'ban_lifted', '{}', '/');
      end if;
    end if;
  end loop;
end $$;

create or replace function public.revoke_strike(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lifted int;
  v_student uuid;
begin
  select student_id into v_student from public.bookings where id = p_booking;
  with revoked as (
    update public.penalties set revoked_at = public.app_now()
    where booking_id = p_booking and revoked_at is null
    returning id
  ), lifted as (
    update public.bans set lifted_at = public.app_now(), lifted_by = auth.uid()
    where penalty_id in (select id from revoked) and lifted_at is null
    returning id
  )
  select count(*) into v_lifted from lifted;
  if v_lifted > 0 then
    perform public.notify(v_student, 'ban_lifted', '{}', '/');
  end if;
  perform public.recount_strikes(v_student);
end $$;

create or replace function public.admin_revoke_penalty(p_penalty uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.penalties;
begin
  perform public.require_admin();
  update public.penalties set revoked_at = public.app_now()
  where id = p_penalty and revoked_at is null returning * into x;
  if found then
    update public.bans set lifted_at = public.app_now(), lifted_by = auth.uid()
    where penalty_id = p_penalty and lifted_at is null;
    perform public.notify(x.student_id,
      case when x.kind = 'ban' then 'ban_lifted' else 'warning_removed' end, '{}', '/');
    perform public.recount_strikes(x.student_id);
    perform public.log_audit('penalty.revoke', 'user', x.student_id::text,
      jsonb_build_object('name', public.name_of(x.student_id), 'kind', x.kind));
  end if;
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
  set status = p_status, marked_by = auth.uid(), marked_at = v_now, auto_marked = false,
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

create function public.admin_update_user(
  p_user uuid, p_first text, p_last text, p_birth_year int, p_bio text, p_active boolean,
  p_phone text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_admin();
  select * into p from public.profiles where id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if p.role = 'admin' and not p_active then
    raise exception 'CANNOT_DEACTIVATE_ADMIN';
  end if;
  update public.profiles
  set first_name = btrim(p_first), last_name = btrim(p_last),
      birth_year = p_birth_year, bio = coalesce(p_bio, ''), is_active = p_active,
      phone = coalesce(left(btrim(p_phone), 30), phone)
  where id = p_user;
  if p.is_active and not p_active then
    perform public.release_user(p_user);
  end if;
  perform public.log_audit('user.update', 'user', p_user::text,
    jsonb_build_object('name', btrim(p_first) || ' ' || btrim(p_last), 'active', p_active));
end $$;

create or replace function public.notify_waitlist() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.waitlist;
begin
  if old.starts_at <= public.app_now()
    or old.lesson_date < public.local_today() + public.setting_int('booking_min_days_ahead')
    or not public.support_is_free(old.support_id, old.starts_at, old.ends_at) then
    return null;
  end if;
  for w in
    delete from public.waitlist
    where support_id = old.support_id and starts_at = old.starts_at
    returning *
  loop
    if (select count(*) from public.bookings b
        where b.student_id = w.student_id and b.status in ('booked', 'needs_transfer'))
        < public.setting_int('max_active_bookings')
      and (public.active_ban(w.student_id)).id is null
      and public.rebook_from(w.student_id) is null then
      perform public.notify(w.student_id, 'waitlist_free', public.booking_vars(old), '/book');
    end if;
  end loop;
  return null;
end $$;

create or replace function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_local_hour int := extract(hour from v_now at time zone public.center_tz());
  v_evening int := public.setting_int('reminder_evening_hour');
  v_soon int := public.setting_int('reminder_before_minutes');
  v_mark interval := public.setting_int('mark_after_minutes') * interval '1 minute';
  v_alert interval := public.setting_int('unmarked_alert_minutes') * interval '1 minute';
  v_auto boolean := public.setting_bool('auto_no_show_enabled');
  v_grace interval := interval '1 hour';
  v_admin uuid;
  v_vars jsonb;
  b public.bookings;
  v_expired int := 0;
  v_unmarked int := 0;
  v_missed int := 0;
  v_alerts int := 0;
  v_reminders int := 0;
begin
  for b in
    update public.bookings set status = 'cancelled', cancel_reason = 'transfer_expired'
    where status = 'needs_transfer' and starts_at <= v_now
    returning *
  loop
    v_expired := v_expired + 1;
    perform public.notify(b.student_id, 'booking_cancelled', public.booking_vars(b), '/');
  end loop;

  for b in
    update public.bookings set reminded_unmarked_at = v_now
    where status = 'booked' and reminded_unmarked_at is null
      and starts_at + v_alert <= v_now and ends_at + v_mark > v_now
    returning *
  loop
    v_alerts := v_alerts + 1;
    v_vars := public.booking_vars(b)
      || jsonb_build_object('deadline', public.fmt_time(b.ends_at + v_mark));
    perform public.notify(b.support_id, 'unmarked_support', v_vars, '/');
    perform public.notify(b.student_id, 'unmarked_student', v_vars, '/');
  end loop;

  if v_auto then
    for b in
      update public.bookings set status = 'no_show', auto_marked = true, marked_at = v_now
      where status = 'booked' and ends_at + v_mark <= v_now
        and ends_at + v_mark + v_grace > v_now
      returning *
    loop
      v_missed := v_missed + 1;
      perform public.apply_strike(b);
      perform public.notify(b.support_id, 'auto_no_show_support', public.booking_vars(b), '/history');
      perform public.log_audit('booking.auto_no_show', 'booking', b.id::text, jsonb_build_object(
        'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id)));
    end loop;
  end if;

  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  for b in
    update public.bookings set status = 'unmarked'
    where status = 'booked'
      and (lesson_date < v_today or (v_auto and ends_at + v_mark + v_grace <= v_now))
    returning *
  loop
    v_unmarked := v_unmarked + 1;
    if v_admin is not null then
      perform public.notify(v_admin, 'unmarked_alert', public.booking_vars(b), '/admin/bookings');
    end if;
  end loop;

  if v_local_hour >= v_evening then
    for b in
      update public.bookings set reminded_day_at = v_now
      where status = 'booked' and reminded_day_at is null and lesson_date = v_today + 1
        and created_at < ((v_today + make_interval(hours => v_evening))::timestamp
          at time zone public.center_tz())
      returning *
    loop
      v_reminders := v_reminders + 1;
      perform public.notify(b.student_id, 'reminder_day',
        public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.support_id)), '/');
      perform public.notify(b.support_id, 'reminder_day',
        public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.student_id)), '/');
    end loop;
  end if;

  for b in
    update public.bookings set reminded_soon_at = v_now
    where status = 'booked' and reminded_soon_at is null
      and starts_at > v_now and starts_at <= v_now + v_soon * interval '1 minute'
    returning *
  loop
    v_reminders := v_reminders + 1;
    perform public.notify(b.student_id, 'reminder_soon',
      public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.support_id)), '/');
    perform public.notify(b.support_id, 'reminder_soon',
      public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.student_id)), '/');
  end loop;

  return jsonb_build_object('expired', v_expired, 'unmarked', v_unmarked, 'missed', v_missed,
    'alerts', v_alerts, 'reminders', v_reminders);
end $$;

create or replace function public.admin_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    with b as (
      select * from public.bookings x where x.lesson_date between p_from and p_to
    ), done as (
      select * from b where status in ('attended', 'no_show')
    )
    select jsonb_build_object(
      'totals', jsonb_build_object(
        'bookings', (select count(*) from b),
        'attended', (select count(*) from b where status = 'attended'),
        'no_show', (select count(*) from b where status = 'no_show'),
        'excused', (select count(*) from b where status = 'excused'),
        'cancelled', (select count(*) from b where status = 'cancelled'),
        'support_absent', (select count(*) from b where status = 'support_absent'),
        'unmarked', (select count(*) from b where status = 'unmarked'),
        'attendance_rate', (select coalesce(round(100.0 * count(*) filter (where status = 'attended')
          / nullif(count(*), 0), 1), 0) from done)
      ),
      'by_support', (
        select coalesce(jsonb_agg(row_to_json(t) order by t.lessons desc, t.name), '[]')
        from (
          select public.full_name(p) as name,
            count(x.id) filter (where x.status = 'attended') as lessons,
            count(x.id) filter (where x.status = 'no_show') as no_shows,
            count(x.id) filter (where x.status = 'excused') as excused,
            count(x.id) filter (where x.auto_marked) as forgot,
            count(x.id) filter (where x.status = 'support_absent') as absent,
            count(x.id) filter (where x.status = 'unmarked') as unmarked,
            (public.rating_of(p.id) ->> 'average')::numeric as rating
          from public.profiles p
          left join b x on x.support_id = p.id
          where p.role = 'support'
          group by p.id
        ) t
      ),
      'by_day', (
        select coalesce(jsonb_agg(row_to_json(t) order by t.day), '[]')
        from (
          select d::date as day,
            (select count(*) from b where lesson_date = d::date and status <> 'cancelled') as bookings
          from generate_series(p_from, p_to, interval '1 day') d
        ) t
      ),
      'by_hour', (
        select coalesce(jsonb_agg(row_to_json(t) order by t.hour), '[]')
        from (
          select extract(hour from starts_at at time zone public.center_tz())::int as hour,
            count(*) as bookings
          from b where status <> 'cancelled' group by 1
        ) t
      ),
      'top_students', (
        select coalesce(jsonb_agg(row_to_json(t) order by t.lessons desc, t.name), '[]')
        from (
          select public.name_of(student_id) as name,
            count(*) filter (where status = 'attended') as lessons,
            count(*) filter (where status = 'no_show') as no_shows
          from b group by student_id
          order by 2 desc limit 10
        ) t
      )
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
         where c.support_id = p.id and c.closed_on between v_from and v_to) as closed_days
      from public.profiles p
      left join public.bookings b
        on b.support_id = p.id and b.lesson_date between v_from and v_to
      where p.role = 'support'
      group by p.id
    ) t
  );
end $$;

create or replace function public.admin_pairs(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(row_to_json(t) order by t.lessons desc, t.support, t.student), '[]')
    from (
      select
        public.name_of(b.support_id) as support,
        public.name_of(b.student_id) as student,
        count(*) filter (where b.status = 'attended') as lessons,
        count(*) filter (where b.status = 'no_show') as missed,
        count(*) filter (where b.status = 'excused') as excused,
        count(*) filter (where b.auto_marked) as forgot,
        count(*) filter (where b.status = 'booked') as upcoming,
        max(b.lesson_date) as last_lesson
      from public.bookings b
      where b.lesson_date between p_from and p_to and b.status <> 'cancelled'
      group by b.support_id, b.student_id
    ) t
  );
end $$;

revoke all on function
  public.rebook_from(uuid),
  public.attendance_counts(uuid, date, date),
  public.attendance_summary(uuid),
  public.recount_strikes(uuid),
  public.my_attendance(),
  public.admin_attendance(uuid),
  public.mark_attendance(uuid, public.booking_status, text),
  public.admin_update_user(uuid, text, text, int, text, boolean, text)
from public, anon, authenticated;

grant execute on function
  public.my_attendance(),
  public.admin_attendance(uuid),
  public.mark_attendance(uuid, public.booking_status, text),
  public.admin_update_user(uuid, text, text, int, text, boolean, text)
to authenticated;
