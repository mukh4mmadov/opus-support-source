create function public.center_tz() returns text
language sql immutable as $$ select 'Asia/Tashkent' $$;

create function public.local_today() returns date
language sql stable as $$
  select (public.app_now() at time zone public.center_tz())::date
$$;

create function public.setting_int(p_key text) returns int
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::int from public.settings where key = p_key
$$;

create function public.setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::boolean from public.settings where key = p_key
$$;

create function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create function public.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
end $$;

create function public.full_name(p public.profiles) returns text
language sql immutable as $$ select p.first_name || ' ' || p.last_name $$;

create function public.name_of(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select public.full_name(p) from public.profiles p where p.id = p_id
$$;

create function public.fmt_date(p_ts timestamptz) returns text
language sql stable as $$
  select to_char(p_ts at time zone public.center_tz(), 'Dy, DD Mon')
$$;

create function public.fmt_time(p_ts timestamptz) returns text
language sql stable as $$
  select to_char(p_ts at time zone public.center_tz(), 'HH24:MI')
$$;

create function public.log_audit(
  p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_details)
$$;

create function public.notify(
  p_user uuid, p_type text, p_vars jsonb default '{}', p_link text default ''
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.notification_templates;
  v_title text;
  v_body text;
  kv record;
begin
  select * into t from public.notification_templates where type = p_type;
  if not found or not t.enabled then
    return;
  end if;
  v_title := t.title;
  v_body := t.body;
  for kv in select key, value from jsonb_each_text(p_vars) loop
    v_title := replace(v_title, '{{' || kv.key || '}}', coalesce(kv.value, ''));
    v_body := replace(v_body, '{{' || kv.key || '}}', coalesce(kv.value, ''));
  end loop;
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, p_type, v_title, v_body, p_link);
end $$;

create function public.booking_vars(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'student', public.name_of(b.student_id),
    'support', public.name_of(b.support_id),
    'date', public.fmt_date(b.starts_at),
    'time', public.fmt_time(b.starts_at),
    'topic', b.topic
  )
$$;

create function public.is_closed(p_support uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.schedule_closures c
    where c.closed_on = p_date and c.start_time is null
      and (c.support_id is null or c.support_id = p_support)
  )
$$;

create function public.is_blocked(
  p_support uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.schedule_closures c
    where c.closed_on = (p_start at time zone public.center_tz())::date
      and (c.support_id is null or c.support_id = p_support)
      and (c.start_time is null or (
        c.start_time < (p_end at time zone public.center_tz())::time
        and c.end_time > (p_start at time zone public.center_tz())::time
      ))
  )
$$;

create function public.slots_for(p_support uuid, p_date date)
returns table (starts_at timestamptz, ends_at timestamptz, is_free boolean)
language sql stable security definer set search_path = '' as $$
  with slot as (
    select
      ((p_date + s.start_time) at time zone public.center_tz())
        + (n * public.setting_int('lesson_minutes')) * interval '1 minute' as st
    from public.weekly_schedules s
    join public.profiles p on p.id = s.support_id and p.is_active and p.role = 'support'
    cross join lateral generate_series(
      0,
      floor(extract(epoch from (s.end_time - s.start_time)) / 60
        / public.setting_int('lesson_minutes'))::int - 1
    ) n
    where s.support_id = p_support
      and s.weekday = extract(isodow from p_date)
      and not public.is_closed(p_support, p_date)
  )
  select distinct
    slot.st,
    slot.st + public.setting_int('lesson_minutes') * interval '1 minute',
    slot.st > public.app_now()
    and not public.is_blocked(p_support, slot.st,
      slot.st + public.setting_int('lesson_minutes') * interval '1 minute')
    and not exists (
      select 1 from public.bookings b
      where b.support_id = p_support and b.status = 'booked'
        and b.starts_at < slot.st + public.setting_int('lesson_minutes') * interval '1 minute'
        and b.ends_at > slot.st
    )
  from slot
  order by 1
$$;

create function public.support_is_free(
  p_support uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    not public.is_blocked(p_support, p_start, p_end)
    and exists (
      select 1 from public.weekly_schedules s
      join public.profiles p on p.id = s.support_id and p.is_active and p.role = 'support'
      where s.support_id = p_support
        and s.weekday = extract(isodow from p_start at time zone public.center_tz())
        and s.start_time <= (p_start at time zone public.center_tz())::time
        and s.end_time >= (p_end at time zone public.center_tz())::time
    )
    and not exists (
      select 1 from public.bookings b
      where b.support_id = p_support and b.status = 'booked'
        and b.starts_at < p_end and b.ends_at > p_start
    )
$$;

create function public.active_ban(p_student uuid) returns public.bans
language sql stable security definer set search_path = '' as $$
  select * from public.bans b
  where b.student_id = p_student and b.lifted_at is null and b.ends_at > public.app_now()
  order by b.ends_at desc limit 1
$$;

create function public.active_strikes(p_student uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.penalties p
  where p.student_id = p_student and p.revoked_at is null
    and p.created_at > public.app_now()
      - public.setting_int('strike_reset_days') * interval '1 day'
$$;

create function public.book_lesson(
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

create function public.cancel_booking(p_booking uuid, p_reason text default '')
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
        case when v_admin then 'admin' else 'student' end)
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

create function public.apply_strike(b public.bookings) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_prior int := public.active_strikes(b.student_id);
  v_penalty uuid;
  v_until timestamptz;
begin
  if v_prior < public.setting_int('warnings_before_ban') then
    insert into public.penalties (student_id, booking_id, kind)
    values (b.student_id, b.id, 'warning');
    perform public.notify(b.student_id, 'warning', public.booking_vars(b), '/');
  else
    v_until := public.app_now() + public.setting_int('ban_hours') * interval '1 hour';
    insert into public.penalties (student_id, booking_id, kind)
    values (b.student_id, b.id, 'ban') returning id into v_penalty;
    insert into public.bans (student_id, penalty_id, starts_at, ends_at, reason)
    values (b.student_id, v_penalty, public.app_now(), v_until, 'no_show');
    perform public.notify(b.student_id, 'ban',
      public.booking_vars(b) || jsonb_build_object(
        'until', public.fmt_date(v_until) || ' ' || public.fmt_time(v_until)), '/');
  end if;
end $$;

create function public.revoke_strike(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lifted int;
  v_student uuid;
begin
  with revoked as (
    update public.penalties set revoked_at = public.app_now()
    where booking_id = p_booking and revoked_at is null
    returning id, student_id
  ), lifted as (
    update public.bans set lifted_at = public.app_now(), lifted_by = auth.uid()
    where penalty_id in (select id from revoked) and lifted_at is null
    returning student_id
  )
  select count(*), min(student_id::text)::uuid into v_lifted, v_student from lifted;
  if v_lifted > 0 then
    perform public.notify(v_student, 'ban_lifted', '{}', '/');
  end if;
end $$;

create function public.mark_attendance(p_booking uuid, p_status public.booking_status)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
  v_now timestamptz := public.app_now();
  b public.bookings;
  v_old public.booking_status;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  v_old := b.status;

  if v_admin then
    if p_status not in ('attended', 'no_show', 'support_absent', 'unmarked') then
      raise exception 'INVALID_STATUS';
    end if;
    if v_old in ('cancelled', 'needs_transfer') then
      raise exception 'BOOKING_NOT_ACTIVE';
    end if;
  else
    if b.support_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
    if p_status not in ('attended', 'no_show') then
      raise exception 'INVALID_STATUS';
    end if;
    if v_old not in ('booked', 'unmarked') then
      raise exception 'ALREADY_MARKED';
    end if;
    if v_now < b.starts_at then
      raise exception 'LESSON_NOT_STARTED';
    end if;
    if p_status = 'no_show' and v_now < b.starts_at
        + public.setting_int('no_show_after_minutes') * interval '1 minute' then
      raise exception 'NO_SHOW_TOO_EARLY';
    end if;
  end if;

  if v_old = p_status then
    return b;
  end if;

  update public.bookings
  set status = p_status, marked_by = auth.uid(), marked_at = v_now
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
  if v_admin then
    perform public.log_audit('booking.mark', 'booking', b.id::text,
      jsonb_build_object('from', v_old, 'to', p_status));
  end if;
  return b;
end $$;

create function public.transfer_options(p_booking uuid)
returns table (support_id uuid, name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not public.is_admin() and b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select p.id, public.full_name(p)
    from public.profiles p
    where p.role = 'support' and p.is_active and p.id <> b.support_id
      and public.support_is_free(p.id, b.starts_at, b.ends_at)
    order by 2;
end $$;

create function public.displace_booking(b public.bookings) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.setting_bool('transfer_enabled') and exists (
    select 1 from public.profiles p
    where p.role = 'support' and p.is_active and p.id <> b.support_id
      and public.support_is_free(p.id, b.starts_at, b.ends_at)
  ) then
    update public.bookings set status = 'needs_transfer' where id = b.id;
    perform public.notify(b.student_id, 'day_closed_transfer', public.booking_vars(b), '/');
  else
    update public.bookings set status = 'cancelled', cancel_reason = 'day_closed' where id = b.id;
    perform public.notify(b.student_id, 'day_closed_cancelled', public.booking_vars(b), '/');
  end if;
end $$;

create function public.apply_closure(
  p_support uuid, p_date date, p_from time default null, p_to time default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_hit int := 0;
begin
  for b in
    select * from public.bookings x
    where x.status = 'booked' and x.lesson_date = p_date
      and x.starts_at > public.app_now()
      and (p_support is null or x.support_id = p_support)
      and (p_from is null or (
        p_from < (x.ends_at at time zone public.center_tz())::time
        and p_to > (x.starts_at at time zone public.center_tz())::time
      ))
    for update
  loop
    v_hit := v_hit + 1;
    perform public.displace_booking(b);
  end loop;
  return v_hit;
end $$;

create function public.close_day(
  p_support uuid, p_date date, p_reason text default '',
  p_from time default null, p_to time default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_admin();
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

  if p_from is not null then
    insert into public.schedule_closures (support_id, closed_on, start_time, end_time, reason, created_by)
    values (p_support, p_date, p_from, p_to, coalesce(p_reason, ''), auth.uid());
  elsif p_support is null then
    insert into public.schedule_closures (support_id, closed_on, reason, created_by)
    values (null, p_date, coalesce(p_reason, ''), auth.uid())
    on conflict (closed_on) where support_id is null and start_time is null do nothing;
  else
    insert into public.schedule_closures (support_id, closed_on, reason, created_by)
    values (p_support, p_date, coalesce(p_reason, ''), auth.uid())
    on conflict (support_id, closed_on) where support_id is not null and start_time is null do nothing;
  end if;

  perform public.log_audit('day.close', 'closure', p_date::text,
    jsonb_build_object('support', p_support, 'reason', p_reason, 'from', p_from, 'to', p_to));
  return public.apply_closure(p_support, p_date, p_from, p_to);
end $$;

create function public.reopen_day(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.schedule_closures;
begin
  select * into c from public.schedule_closures where id = p_closure;
  if not found then
    raise exception 'CLOSURE_NOT_FOUND';
  end if;
  if not public.is_admin() and (c.support_id is null or c.support_id is distinct from auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.schedule_closures where id = p_closure;
  perform public.log_audit('day.reopen', 'closure', c.closed_on::text,
    jsonb_build_object('support', c.support_id));
end $$;

create function public.accept_transfer(p_booking uuid, p_support uuid)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not public.is_admin() and b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'needs_transfer' then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if p_support = b.support_id or not public.support_is_free(p_support, b.starts_at, b.ends_at) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    update public.bookings set status = 'booked', support_id = p_support
    where id = p_booking returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  perform public.notify(b.student_id, 'transfer_done', public.booking_vars(b), '/');
  perform public.notify(p_support, 'transfer_new', public.booking_vars(b), '/');
  return b;
end $$;

create function public.decline_transfer(p_booking uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not public.is_admin() and b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'needs_transfer' then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  update public.bookings set status = 'cancelled', cancel_reason = 'transfer_declined'
  where id = p_booking returning * into b;
  return b;
end $$;

create function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_local_hour int := extract(hour from v_now at time zone public.center_tz());
  v_evening int := public.setting_int('reminder_evening_hour');
  v_soon int := public.setting_int('reminder_before_minutes');
  v_admin uuid;
  b public.bookings;
  v_expired int := 0;
  v_unmarked int := 0;
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

  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  for b in
    update public.bookings set status = 'unmarked'
    where status = 'booked' and lesson_date < v_today
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

  return jsonb_build_object('expired', v_expired, 'unmarked', v_unmarked, 'reminders', v_reminders);
end $$;

create function public.send_message(p_booking uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_to uuid;
  m public.messages;
begin
  if not public.setting_bool('chat_enabled') then
    raise exception 'CHAT_DISABLED';
  end if;
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_me not in (b.student_id, b.support_id) then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'booked' then
    raise exception 'CHAT_CLOSED';
  end if;
  if v_body = '' or length(v_body) > 2000 then
    raise exception 'MESSAGE_INVALID';
  end if;

  insert into public.messages (booking_id, sender_id, body)
  values (p_booking, v_me, v_body) returning * into m;

  v_to := case when v_me = b.student_id then b.support_id else b.student_id end;
  perform public.notify(v_to, 'chat_message', jsonb_build_object(
    'sender', public.name_of(v_me), 'preview', left(v_body, 100)), '/chat/' || p_booking);
  return m;
end $$;

create function public.submit_review(p_booking uuid, p_rating int, p_comment text default '')
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  r public.reviews;
begin
  if not public.setting_bool('reviews_enabled') then
    raise exception 'REVIEWS_DISABLED';
  end if;
  select * into b from public.bookings where id = p_booking;
  if not found or b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'attended' then
    raise exception 'REVIEW_NOT_ALLOWED';
  end if;
  if p_rating not between 1 and 5 then
    raise exception 'RATING_INVALID';
  end if;
  insert into public.reviews (booking_id, student_id, support_id, rating, comment)
  values (b.id, b.student_id, b.support_id, p_rating, left(btrim(coalesce(p_comment, '')), 1000))
  on conflict (booking_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into r;
  return r;
end $$;
