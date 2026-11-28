create table public.booking_moves (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  from_starts_at timestamptz not null,
  to_starts_at timestamptz not null,
  created_at timestamptz not null default public.app_now()
);
create index booking_moves_student_idx on public.booking_moves (student_id, created_at);
alter table public.booking_moves enable row level security;
revoke all on public.booking_moves from anon, authenticated;

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('moves_per_month', '2', 'int', 'Booking', 'Lesson time changes per student per month', 'Until the end of the day before a lesson, the student can move it to another free time without cancelling. 0 turns this off.', false, 82);

create function public.moves_left(p_student uuid) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(0, public.setting_int('moves_per_month') - (
    select count(*)::int from public.booking_moves m
    where m.student_id = p_student
      and date_trunc('month', m.created_at at time zone public.center_tz())
        = date_trunc('month', public.app_now() at time zone public.center_tz())
  ))
$$;

create function public.move_booking(
  p_booking uuid, p_support uuid, p_starts_at timestamptz, p_topic text default null
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_today date := public.local_today();
  v_date date := (p_starts_at at time zone public.center_tz())::date;
  v_topic text;
  v_end timestamptz;
  v_old public.bookings;
  b public.bookings;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  perform 1 from public.profiles where id = v_me for update;
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.student_id is distinct from v_me then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'booked' then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if v_today > b.lesson_date - public.setting_int('cancel_days_before') then
    raise exception 'MOVE_TOO_LATE';
  end if;
  if public.moves_left(v_me) < 1 then
    raise exception 'MOVE_LIMIT';
  end if;
  if (public.active_ban(v_me)).id is not null then
    raise exception 'STUDENT_BANNED';
  end if;
  if v_date < v_today + public.setting_int('booking_min_days_ahead')
    or v_date > v_today + public.setting_int('booking_max_days_ahead') then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;
  if (select count(*) from public.bookings x
      where x.student_id = v_me and x.lesson_date = v_date and x.id <> b.id
        and x.status not in ('cancelled', 'support_absent'))
      >= public.setting_int('max_bookings_per_day') then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;
  v_topic := coalesce(btrim(p_topic), b.topic);
  if public.setting_bool('topic_required') and v_topic = '' then
    raise exception 'TOPIC_REQUIRED';
  end if;
  if length(v_topic) > public.setting_int('topic_max_length') then
    raise exception 'TOPIC_TOO_LONG';
  end if;

  v_old := b;
  update public.bookings set status = 'needs_transfer' where id = b.id;
  select s.ends_at into v_end
  from public.slots_for(p_support, v_date) s
  where s.starts_at = p_starts_at and s.is_free;
  if v_end is null or (p_support = v_old.support_id and p_starts_at = v_old.starts_at) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    update public.bookings
    set status = 'booked', support_id = p_support, starts_at = p_starts_at, ends_at = v_end,
        lesson_date = v_date, topic = v_topic,
        reminded_day_at = null, reminded_soon_at = null, reminded_unmarked_at = null,
        checkin_tries = 0
    where id = b.id returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;
  delete from public.checkin_codes where booking_id = b.id;
  insert into public.booking_moves (booking_id, student_id, from_starts_at, to_starts_at)
  values (b.id, v_me, v_old.starts_at, b.starts_at);

  perform public.notify(v_old.support_id, 'booking_cancelled', public.booking_vars(v_old), '/');
  perform public.notify(b.support_id, 'booking_new', public.booking_vars(b), '/');
  perform public.log_audit('booking.move_self', 'booking', b.id::text, jsonb_build_object(
    'student', public.name_of(v_me), 'from', v_old.starts_at, 'to', b.starts_at,
    'from_support', public.name_of(v_old.support_id), 'to_support', public.name_of(b.support_id)));
  return b;
end $$;

create function public.displace_outcome(b public.bookings) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.setting_bool('transfer_enabled') and exists (
    select 1 from public.profiles p
    where p.role = 'support' and p.is_active and p.id <> b.support_id
      and public.support_is_free(p.id, b.starts_at, b.ends_at)
  ) then 'transfer' else 'cancel' end
$$;

create function public.affected_json(b public.bookings, p_outcome text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'student_name', public.name_of(b.student_id), 'support_name', public.name_of(b.support_id),
    'starts_at', b.starts_at, 'outcome', p_outcome)
$$;

create function public.closure_preview(
  p_support uuid, p_date date, p_from time default null, p_to time default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() and (p_support is null or p_support is distinct from auth.uid()
      or public.my_role() is distinct from 'support') then
    raise exception 'FORBIDDEN';
  end if;
  if (p_from is null) <> (p_to is null) or p_to <= p_from then
    raise exception 'HOURS_INVALID';
  end if;
  return (
    select coalesce(jsonb_agg(public.affected_json(x,
      case when p_support is null then 'cancel' else public.displace_outcome(x) end
    ) order by x.starts_at), '[]')
    from public.bookings x
    where x.status = 'booked' and x.lesson_date = p_date
      and x.starts_at > public.app_now()
      and (p_support is null or x.support_id = p_support)
      and (p_from is null or (
        p_from < (x.ends_at at time zone public.center_tz())::time
        and p_to > (x.starts_at at time zone public.center_tz())::time
      ))
  );
end $$;

create function public.admin_schedule_preview(p_support uuid, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(public.affected_json(x, public.displace_outcome(x)) order by x.starts_at), '[]')
    from public.bookings x
    where x.support_id = p_support and x.status = 'booked' and x.starts_at > public.app_now()
      and not exists (
        select 1 from jsonb_to_recordset(p_rows) as r(weekday int, start_time time, end_time time)
        where r.weekday = extract(isodow from x.starts_at at time zone public.center_tz())
          and r.start_time <= (x.starts_at at time zone public.center_tz())::time
          and r.end_time >= (x.ends_at at time zone public.center_tz())::time
      )
  );
end $$;

create function public.admin_workload(p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_monday date := p_week_start - (extract(isodow from p_week_start)::int - 1);
begin
  perform public.require_admin();
  return jsonb_build_object(
    'week_start', v_monday,
    'supports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', public.full_name(p),
        'days', (
          select jsonb_agg(jsonb_build_object(
            'date', d::date,
            'booked', (select count(*) from public.bookings b
                       where b.support_id = p.id and b.lesson_date = d::date
                         and b.status not in ('cancelled', 'needs_transfer')),
            'sessions', (select count(*) from public.slots_for(p.id, d::date))
          ) order by d)
          from generate_series(v_monday, v_monday + 6, interval '1 day') d
        )
      ) order by p.first_name, p.last_name), '[]')
      from public.profiles p
      where p.role = 'support' and p.is_active
    )
  );
end $$;

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
    'moves_left', public.moves_left(v_me),
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
      'cancel_days_before', public.setting_int('cancel_days_before'),
      'moves_per_month', public.setting_int('moves_per_month')
    ),
    'today', public.local_today()
  );
end $$;

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
      'instant_minutes', public.setting_int('instant_expire_minutes'),
      'instant_per_day', public.setting_int('instant_per_day'),
      'daily_minutes', public.setting_int('daily_max_minutes'),
      'moves_per_month', public.setting_int('moves_per_month')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

revoke all on function
  public.moves_left(uuid),
  public.move_booking(uuid, uuid, timestamptz, text),
  public.displace_outcome(public.bookings),
  public.affected_json(public.bookings, text),
  public.closure_preview(uuid, date, time, time),
  public.admin_schedule_preview(uuid, jsonb),
  public.admin_workload(date)
from public, anon, authenticated;

grant execute on function
  public.move_booking(uuid, uuid, timestamptz, text),
  public.closure_preview(uuid, date, time, time),
  public.admin_schedule_preview(uuid, jsonb),
  public.admin_workload(date)
to authenticated;
