alter type public.user_role add value if not exists 'manager';

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role()::text in ('admin', 'manager'), false)
$$;

create function public.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'FORBIDDEN';
  end if;
end $$;

create function public.require_staff_over(p_user uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.is_admin() then
    return;
  end if;
  if not public.is_staff() or not exists (
    select 1 from public.profiles p where p.id = p_user and p.role::text in ('student', 'support')
  ) then
    raise exception 'FORBIDDEN';
  end if;
end $$;

create or replace function public.admin_bookings(
  p_from date, p_to date, p_status public.booking_status default null, p_support uuid default null,
  p_search text default '', p_limit int default 200
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at desc), '[]')
    from (
      select x.* from public.bookings x
      join public.profiles s on s.id = x.student_id
      where x.lesson_date between p_from and p_to
        and (p_status is null or x.status = p_status)
        and (p_support is null or x.support_id = p_support)
        and (coalesce(p_search, '') = ''
          or (s.first_name || ' ' || s.last_name) ilike '%' || p_search || '%')
      order by x.starts_at desc limit p_limit
    ) b
  );
end $$;

create or replace function public.admin_closures(p_past boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'closed_on', c.closed_on, 'reason', c.reason, 'support_id', c.support_id,
      'same_day', c.same_day,
      'start_time', to_char(c.start_time, 'HH24:MI'),
      'end_time', to_char(c.end_time, 'HH24:MI'),
      'support_name', case when c.support_id is null then null
                      else public.name_of(c.support_id) end
    ) order by c.closed_on desc, c.start_time), '[]')
    from public.schedule_closures c
    where p_past or c.closed_on >= public.local_today()
  );
end $$;

create or replace function public.admin_list_users(
  p_role public.user_role default null, p_search text default ''
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'role', p.role, 'login', p.login,
      'first_name', p.first_name, 'last_name', p.last_name,
      'birth_year', p.birth_year,
      'bio', case when public.is_admin() then p.bio else '' end,
      'phone', p.phone, 'is_active', p.is_active,
      'created_at', p.created_at,
      'archived_at', p.archived_at,
      'password_changed_at', p.password_changed_at,
      'strikes', case when public.is_admin() then public.active_strikes(p.id) else 0 end,
      'banned_until', case when public.is_admin() then (public.active_ban(p.id)).ends_at else null end,
      'push_devices', (select count(*) from public.push_subscriptions s where s.user_id = p.id),
      'lessons', (select count(*) from public.bookings b
                  where (b.student_id = p.id or b.support_id = p.id) and b.status = 'attended'),
      'no_shows', (select count(*) from public.bookings b
                   where b.student_id = p.id and b.status = 'no_show'),
      'rating', case when p.role = 'support' then public.rating_of(p.id) end,
      'schedule', case when p.role = 'support' then public.schedule_of(p.id) end
    ) order by p.first_name, p.last_name), '[]')
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (public.is_admin() or p.role::text in ('student', 'support'))
      and (coalesce(p_search, '') = ''
        or (p.first_name || ' ' || p.last_name || ' ' || p.login) ilike '%' || p_search || '%')
  );
end $$;

create or replace function public.admin_waitlist() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'student_name', public.name_of(w.student_id),
      'support_name', public.name_of(w.support_id), 'starts_at', w.starts_at,
      'created_at', w.created_at
    ) order by w.starts_at, w.created_at), '[]')
    from public.waitlist w
    where w.starts_at > public.app_now()
  );
end $$;

create or replace function public.admin_set_schedule(p_support uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_hit int := 0;
begin
  perform public.require_staff();
  if not exists (select 1 from public.profiles where id = p_support and role = 'support') then
    raise exception 'SUPPORT_NOT_FOUND';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(weekday int, start_time time, end_time time)
    where r.end_time <= r.start_time or r.weekday not between 1 and 7
  ) then
    raise exception 'SCHEDULE_INVALID';
  end if;
  if not public.is_admin() and exists (
    select 1 from public.bookings x
    where x.support_id = p_support and x.status = 'booked' and x.starts_at > public.app_now()
      and not exists (
        select 1 from jsonb_to_recordset(p_rows) as r(weekday int, start_time time, end_time time)
        where r.weekday = extract(isodow from x.starts_at at time zone public.center_tz())
          and r.start_time <= (x.starts_at at time zone public.center_tz())::time
          and r.end_time >= (x.ends_at at time zone public.center_tz())::time
      )
  ) then
    raise exception 'BOOKINGS_AFFECTED_OWNER_ONLY';
  end if;

  delete from public.weekly_schedules where support_id = p_support;
  insert into public.weekly_schedules (support_id, weekday, start_time, end_time)
  select p_support, r.weekday, r.start_time, r.end_time
  from jsonb_to_recordset(p_rows) as r(weekday int, start_time time, end_time time);

  for b in
    select * from public.bookings x
    where x.support_id = p_support and x.status = 'booked' and x.starts_at > public.app_now()
      and not exists (
        select 1 from public.weekly_schedules s
        where s.support_id = p_support
          and s.weekday = extract(isodow from x.starts_at at time zone public.center_tz())
          and s.start_time <= (x.starts_at at time zone public.center_tz())::time
          and s.end_time >= (x.ends_at at time zone public.center_tz())::time
      )
    for update
  loop
    v_hit := v_hit + 1;
    perform public.displace_booking(b);
  end loop;

  perform public.log_audit('schedule.update', 'user', p_support::text,
    jsonb_build_object('name', public.name_of(p_support), 'displaced', v_hit));
  return v_hit;
end $$;

create or replace function public.admin_schedule_preview(p_support uuid, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
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

create or replace function public.admin_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
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
  perform public.require_staff();
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
  perform public.require_staff();
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

create or replace function public.admin_workload(p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_monday date := p_week_start - (extract(isodow from p_week_start)::int - 1);
begin
  perform public.require_staff();
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

create or replace function public.admin_reviews(p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment, 'is_hidden', r.is_hidden,
      'student_name', public.name_of(r.student_id), 'support_name', public.name_of(r.support_id),
      'created_at', r.created_at
    ) order by r.created_at desc), '[]')
    from (select * from public.reviews order by created_at desc limit p_limit) r
  );
end $$;

create or replace function public.admin_complaints(p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'body', t.body, 'reply', t.reply, 'answered_at', t.answered_at,
      'seen_at', t.seen_at, 'created_at', t.created_at, 'booking', public.booking_json(b)
    ) order by t.answered_at is not null, t.created_at desc), '[]')
    from (
      select * from public.complaints c
      order by c.answered_at is not null, c.created_at desc limit p_limit
    ) t
    join public.bookings b on b.id = t.booking_id
  );
end $$;

create or replace function public.admin_complaints_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_staff();
  update public.complaints set seen_at = public.app_now() where seen_at is null;
end $$;

create or replace function public.admin_answer_complaint(p_complaint uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reply text := left(btrim(coalesce(p_reply, '')), 1000);
  c public.complaints;
  b public.bookings;
begin
  perform public.require_staff();
  if v_reply = '' then
    raise exception 'COMPLAINT_EMPTY';
  end if;
  update public.complaints
  set reply = v_reply, answered_at = public.app_now(), seen_at = coalesce(seen_at, public.app_now())
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

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.local_today();
begin
  perform public.require_staff();
  return jsonb_build_object(
    'today', v_today,
    'students', (select count(*) from public.profiles where role = 'student' and is_active),
    'supports', (select count(*) from public.profiles where role = 'support' and is_active),
    'open_complaints', (select count(*) from public.complaints where answered_at is null),
    'complaints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'student_name', public.name_of(c.student_id),
        'support_name', public.name_of(b.support_id), 'lesson_at', b.starts_at,
        'created_at', c.created_at, 'seen_at', c.seen_at
      ) order by c.created_at), '[]')
      from public.complaints c join public.bookings b on b.id = c.booking_id
      where c.answered_at is null
    ),
    'mark_after_minutes', public.setting_int('mark_after_minutes'),
    'auto_no_show', public.setting_bool('auto_no_show_enabled'),
    'lessons_today', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at), '[]')
      from public.bookings b where b.lesson_date = v_today and b.status <> 'cancelled'
    ),
    'unmarked', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at desc), '[]')
      from public.bookings b
      where b.status = 'unmarked'
        or (b.status = 'booked' and b.ends_at < public.app_now())
    ),
    'waiting_transfer', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at), '[]')
      from public.bookings b where b.status = 'needs_transfer'
    ),
    'active_bans', case when public.is_admin() then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id,
        'student_name', public.name_of(x.student_id),
        'ends_at', x.ends_at, 'reason', x.reason
      ) order by x.ends_at), '[]')
      from public.bans x where x.lifted_at is null and x.ends_at > public.app_now()
    ) else '[]'::jsonb end,
    'upcoming_count', (select count(*) from public.bookings b
                       where b.status = 'booked' and b.starts_at > public.app_now())
  );
end $$;

create or replace function public.admin_attendance(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  return public.attendance_summary(p_user);
end $$;

create or replace function public.admin_attendance_series(p_user uuid, p_unit text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  return public.attendance_series(p_user, p_unit);
end $$;

create or replace function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  select * into p from public.profiles where id = p_user;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'profile', case when public.is_admin() then to_jsonb(p) else to_jsonb(p) - 'bio' end,
    'bookings', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at desc), '[]')
      from public.bookings b where p_user in (b.student_id, b.support_id)
    ),
    'penalties', case when public.is_admin() then (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]')
      from public.penalties x where x.student_id = p_user
    ) else '[]'::jsonb end,
    'bans', case when public.is_admin() then (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]')
      from public.bans x where x.student_id = p_user
    ) else '[]'::jsonb end,
    'reviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'rating', r.rating, 'comment', r.comment, 'is_hidden', r.is_hidden,
        'student_name', public.name_of(r.student_id), 'support_name', public.name_of(r.support_id),
        'created_at', r.created_at
      ) order by r.created_at desc), '[]')
      from public.reviews r where p_user in (r.student_id, r.support_id)
    ),
    'chats', case when public.is_admin() then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'booking_id', c.id, 'student_name', public.name_of(c.student_id),
        'support_name', public.name_of(c.support_id), 'starts_at', c.starts_at, 'messages', c.messages
      ) order by c.starts_at desc), '[]')
      from (
        select b.id, b.student_id, b.support_id, b.starts_at, count(m.id) as messages
        from public.bookings b
        join public.messages m on m.booking_id = b.id
        where p_user in (b.student_id, b.support_id)
        group by b.id
      ) c
    ) else '[]'::jsonb end,
    'strikes', case when public.is_admin() then public.active_strikes(p_user) else 0 end,
    'schedule', public.schedule_of(p_user),
    'rating', public.rating_of(p_user)
  );
end $$;

create or replace function public.admin_user_extras(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  return jsonb_build_object(
    'push_devices', (select count(*) from public.push_subscriptions s where s.user_id = p_user),
    'rebook_from', public.rebook_from(p_user),
    'hidden_from_top', (select p.hidden_from_top from public.profiles p where p.id = p_user)
  );
end $$;

create or replace function public.admin_clear_rebook(p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_staff();
  perform public.require_staff_over(p_student);
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'STUDENT_NOT_FOUND';
  end if;
  update public.bookings set rebook_from = null
  where student_id = p_student and rebook_from is not null;
  perform public.log_audit('user.rebook_open', 'user', p_student::text,
    jsonb_build_object('name', public.name_of(p_student)));
end $$;

create or replace function public.admin_update_user(
  p_user uuid, p_first text, p_last text, p_birth_year int, p_bio text, p_active boolean,
  p_phone text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  if not public.is_admin() then
    select x.bio into p_bio from public.profiles x where x.id = p_user;
  end if;
  select * into p from public.profiles where id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if not public.is_admin() and p_active is distinct from p.is_active then
    raise exception 'FORBIDDEN';
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

create or replace function public.admin_set_archived(p_user uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_staff();
  perform public.require_staff_over(p_user);
  select * into p from public.profiles where id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  if not public.is_admin() and p_archived and exists (
    select 1 from public.bookings b
    where p_user in (b.student_id, b.support_id)
      and b.status in ('booked', 'needs_transfer') and b.starts_at > public.app_now()
  ) then
    raise exception 'OPEN_BOOKINGS_OWNER_ONLY';
  end if;
  if p.role = 'admin' then
    raise exception 'CANNOT_DEACTIVATE_ADMIN';
  end if;
  update public.profiles
  set is_active = not p_archived,
      archived_at = case when p_archived then public.app_now() end
  where id = p_user;
  if p_archived and p.is_active then
    perform public.release_user(p_user);
  end if;
  perform public.log_audit(case when p_archived then 'user.archive' else 'user.restore' end,
    'user', p_user::text, jsonb_build_object('name', public.full_name(p)));
end $$;

create or replace function public.reopen_day(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.schedule_closures;
begin
  select * into c from public.schedule_closures where id = p_closure;
  if not found then
    raise exception 'CLOSURE_NOT_FOUND';
  end if;
  if not public.is_staff() and (c.support_id is null or c.support_id is distinct from auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.schedule_closures where id = p_closure;
  perform public.log_audit('day.reopen', 'closure', c.closed_on::text,
    jsonb_build_object('support', c.support_id));
end $$;

create or replace function public.closure_preview(
  p_support uuid, p_date date, p_from time default null, p_to time default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() and (p_support is null or p_support is distinct from auth.uid()
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

create or replace function public.support_calendar(p_from date, p_to date, p_support uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_support uuid := coalesce(p_support, auth.uid());
begin
  if not public.is_staff() and (v_support is distinct from auth.uid()
      or public.my_role() is distinct from 'support') then
    raise exception 'FORBIDDEN';
  end if;
  return jsonb_build_object(
    'bookings', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at), '[]')
      from public.bookings b
      where b.support_id = v_support and b.lesson_date between p_from and p_to
        and b.status <> 'cancelled'
    ),
    'closures', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'closed_on', c.closed_on, 'reason', c.reason,
        'center_wide', c.support_id is null,
        'start_time', to_char(c.start_time, 'HH24:MI'),
        'end_time', to_char(c.end_time, 'HH24:MI')
      ) order by c.closed_on, c.start_time), '[]')
      from public.schedule_closures c
      where (c.support_id = v_support or c.support_id is null)
        and c.closed_on between p_from and p_to
    ),
    'schedule', public.schedule_of(v_support)
  );
end $$;

create or replace function public.close_day(
  p_support uuid, p_date date, p_reason text default '',
  p_from time default null, p_to time default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean := public.is_staff();
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
  if public.my_role()::text = 'manager' and exists (
    select 1 from public.bookings x
    where x.status = 'booked' and x.lesson_date = p_date
      and x.starts_at > public.app_now()
      and (p_support is null or x.support_id = p_support)
      and (p_from is null or (
        p_from < (x.ends_at at time zone public.center_tz())::time
        and p_to > (x.starts_at at time zone public.center_tz())::time
      ))
  ) then
    raise exception 'BOOKINGS_AFFECTED_OWNER_ONLY';
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
    from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
  end if;
  return v_hit;
end $$;

create or replace function public.send_complaint(p_booking uuid, p_body text) returns void
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
  from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
end $$;

create function public.forward_excused_alert_to_managers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'excused_alert' and exists (
    select 1 from public.profiles where id = new.user_id and role = 'admin'
  ) then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, new.type, new.title, new.body, new.link
    from public.profiles p where p.role = 'manager' and p.is_active;
  end if;
  return new;
end $$;

create trigger forward_excused_alert_to_managers
after insert on public.notifications
for each row execute function public.forward_excused_alert_to_managers();

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
    perform public.notify(p.id, 'unmarked_alert', public.booking_vars(b), '/admin/bookings')
    from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
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

create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  perform public.require_admin();
  v_out := jsonb_build_object(
    'People', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', p.role, 'first_name', p.first_name, 'last_name', p.last_name, 'login', p.login,
        'phone', p.phone, 'birth_year', p.birth_year, 'active', p.is_active,
        'archived_at', p.archived_at,
        'password_changed_at', p.password_changed_at, 'created_at', p.created_at
      ) order by p.role, p.first_name), '[]')
      from public.profiles p
    ),
    'Lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', b.lesson_date, 'starts_at', b.starts_at, 'student', public.name_of(b.student_id),
        'support', public.name_of(b.support_id), 'topic', b.topic, 'status', b.status,
        'cancel_reason', b.cancel_reason, 'excuse_reason', b.excuse_reason,
        'marked_at', b.marked_at, 'qr_scanned_at', b.checked_in_at,
        'not_confirmed_in_time', b.auto_marked, 'created_at', b.created_at
      ) order by b.starts_at desc), '[]')
      from public.bookings b
    ),
    'Chats', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sent_at', m.created_at, 'from', public.name_of(m.sender_id),
        'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id),
        'message', m.body, 'removed_at', m.deleted_at
      ) order by m.created_at desc), '[]')
      from public.messages m join public.bookings b on b.id = m.booking_id
    ),
    'Reviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', r.created_at, 'student', public.name_of(r.student_id),
        'support', public.name_of(r.support_id), 'rating', r.rating, 'comment', r.comment,
        'hidden', r.is_hidden
      ) order by r.created_at desc), '[]')
      from public.reviews r
    ),
    'Complaints', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', c.created_at, 'student', public.name_of(c.student_id),
        'support', public.name_of(b.support_id), 'lesson', b.starts_at,
        'complaint', c.body, 'answer', c.reply, 'answered_at', c.answered_at
      ) order by c.created_at desc), '[]')
      from public.complaints c join public.bookings b on b.id = c.booking_id
    ),
    'Strikes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'created_at', x.created_at, 'student', public.name_of(x.student_id), 'kind', x.kind,
        'note', x.note, 'removed_at', x.revoked_at
      ) order by x.created_at desc), '[]')
      from public.penalties x
    ),
    'Bans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'student', public.name_of(x.student_id), 'from', x.starts_at, 'until', x.ends_at,
        'reason', x.reason, 'lifted_at', x.lifted_at
      ) order by x.created_at desc), '[]')
      from public.bans x
    ),
    'Closed days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', c.closed_on, 'who', coalesce(public.name_of(c.support_id), 'Whole center'),
        'from', c.start_time, 'to', c.end_time, 'reason', c.reason, 'on_the_day', c.same_day
      ) order by c.closed_on desc), '[]')
      from public.schedule_closures c
    ),
    'Activity log', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'at', a.created_at, 'who', coalesce(public.name_of(a.actor_id), 'System'),
        'action', a.action, 'details', a.details::text
      ) order by a.id desc), '[]')
      from public.audit_log a
    )
  );
  if not public.is_admin() then
    v_out := v_out - 'Chats' - 'Activity log' - 'Strikes' - 'Bans';
  end if;
  return v_out;
end $$;

create or replace function public.notification_link(p_type text, p_link text, p_role text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_role = 'support' and coalesce(p_link, '') in ('', '/') and p_type in (
      'booking_new', 'booking_cancelled', 'booking_moved', 'transfer_done', 'lesson_rescheduled'
    ) then '/calendar'
    when coalesce(p_link, '') <> '' then p_link
    when p_type in ('lesson_excused', 'complaint_answered', 'auto_no_show_support', 'review_request') then '/history'
    when p_type in ('excused_alert', 'unmarked_alert') then '/admin/bookings'
    when p_type = 'complaint_new' then '/admin/complaints'
    when p_type = 'password_changed' then '/profile'
    when p_role in ('admin', 'manager') then '/admin'
    else '/'
  end
$$;

revoke all on function public.is_staff(), public.require_staff(), public.require_staff_over(uuid)
from public, anon, authenticated;
revoke all on function public.forward_excused_alert_to_managers()
from public, anon, authenticated;
