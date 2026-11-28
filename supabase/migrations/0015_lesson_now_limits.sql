alter table public.profiles add column present_on date;

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('instant_per_day', '1', 'int', 'Booking', 'Lessons now per student per day', '', false, 96),
  ('daily_max_minutes', '60', 'int', 'Booking', 'Most lesson time per student per day (minutes)', 'A lesson now is refused if it would take the student over this, together with lessons already booked today.', false, 97);

create function public.set_at_center(p_present boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  update public.profiles set present_on = case when p_present then public.local_today() end
  where id = auth.uid();
end $$;

create function public.support_presence() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p.present_on = public.local_today(), false)
  from public.profiles p where p.id = auth.uid()
$$;

create or replace function public.instant_check_student(p_student uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (p_start at time zone public.center_tz())::date;
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
  if (select count(*) from public.bookings b
      where b.student_id = p_student and b.instant and b.lesson_date = v_today and b.status <> 'cancelled')
      >= public.setting_int('instant_per_day') then
    raise exception 'INSTANT_DAILY_LIMIT';
  end if;
  if (select coalesce(sum(extract(epoch from b.ends_at - b.starts_at) / 60), 0) from public.bookings b
      where b.student_id = p_student and b.lesson_date = v_today
        and b.status in ('booked', 'attended', 'no_show', 'unmarked'))
      + extract(epoch from p_end - p_start) / 60 > public.setting_int('daily_max_minutes') then
    raise exception 'DAILY_TIME_LIMIT';
  end if;
end $$;

drop function public.instant_supports();

create function public.instant_supports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz := date_trunc('minute', public.app_now());
  v_end timestamptz := v_start + public.setting_int('lesson_minutes') * interval '1 minute';
  v_reason text;
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  begin
    perform public.instant_check_student(auth.uid(), v_start, v_end);
  exception when raise_exception then
    v_reason := sqlerrm;
  end;
  return jsonb_build_object(
    'reason', v_reason,
    'supports', case when v_reason is not null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', public.full_name(p), 'rating', public.rating_of(p.id)
      ) order by p.first_name, p.last_name), '[]')
      from public.profiles p
      where p.role = 'support' and p.is_active and p.present_on = public.local_today()
        and public.support_is_free(p.id, v_start, v_end)
    ) end
  );
end $$;

create or replace function public.instant_request(p_support uuid, p_topic text default '') returns public.instant_requests
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
  if not exists (
      select 1 from public.profiles p
      where p.id = p_support and p.role = 'support' and p.is_active and p.present_on = public.local_today())
    or not public.support_is_free(p_support, v_start, v_end) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  insert into public.instant_requests (student_id, support_id, topic)
  values (v_me, p_support, v_topic) returning * into r;
  perform public.notify(p_support, 'instant_request', jsonb_build_object(
    'student', public.name_of(v_me), 'topic', coalesce(nullif(v_topic, ''), '-')), '/');
  return r;
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
        'instant', (select count(*) from b where status = 'attended' and instant),
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
            count(x.id) filter (where x.status = 'attended' and x.instant) as instant,
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
        count(*) filter (where b.status = 'attended' and b.instant) as instant,
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
        count(b.id) filter (where b.status = 'attended' and b.instant) as instant,
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
      'daily_minutes', public.setting_int('daily_max_minutes')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

revoke all on function
  public.set_at_center(boolean),
  public.support_presence(),
  public.instant_supports()
from public, anon, authenticated;

grant execute on function
  public.set_at_center(boolean),
  public.support_presence(),
  public.instant_supports()
to authenticated;
