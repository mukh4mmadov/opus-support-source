create function public.booking_json(b public.bookings) returns jsonb
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
    'can_cancel', b.status = 'needs_transfer' or (b.status = 'booked'
      and public.local_today() <= b.lesson_date - public.setting_int('cancel_days_before')),
    'no_show_from', b.starts_at
      + public.setting_int('no_show_after_minutes') * interval '1 minute'
  )
$$;

create function public.announcements_for(p_role public.user_role) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'title', a.title, 'body', a.body, 'created_at', a.created_at
  ) order by a.created_at desc), '[]')
  from public.announcements a
  where a.is_active and (a.audience = 'all' or a.audience = p_role::text or p_role = 'admin')
$$;

create function public.rating_of(p_support uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'average', coalesce(round(avg(r.rating), 2), 0),
    'count', count(*)
  )
  from public.reviews r
  where r.support_id = p_support and not r.is_hidden
$$;

create function public.schedule_of(p_support uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday', s.weekday,
    'start_time', to_char(s.start_time, 'HH24:MI'),
    'end_time', to_char(s.end_time, 'HH24:MI')
  ) order by s.weekday, s.start_time), '[]')
  from public.weekly_schedules s
  where s.support_id = p_support
$$;

create function public.get_public_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select coalesce(jsonb_object_agg(key, value), '{}')
                 from public.settings where is_public),
    'strings', (select coalesce(jsonb_object_agg(key, value), '{}') from public.ui_strings)
  )
$$;

create function public.get_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'login', p.login,
    'first_name', p.first_name, 'last_name', p.last_name,
    'chat_enabled', public.setting_bool('chat_enabled'),
    'reviews_enabled', public.setting_bool('reviews_enabled'),
    'unread', (select count(*) from public.notifications n
               where n.user_id = p.id and n.read_at is null)
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create function public.student_home() returns jsonb
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
    'transfer_options', v_options,
    'ban', case when v_ban.id is null then null
      else jsonb_build_object('ends_at', v_ban.ends_at, 'reason', v_ban.reason) end,
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

create function public.list_supports() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', public.full_name(p),
    'bio', p.bio,
    'rating', public.rating_of(p.id),
    'schedule', public.schedule_of(p.id),
    'next_free', (
      select min(s.starts_at)
      from generate_series(
        public.local_today() + public.setting_int('booking_min_days_ahead'),
        public.local_today() + public.setting_int('booking_max_days_ahead'),
        interval '1 day'
      ) d
      cross join lateral public.slots_for(p.id, d::date) s
      where s.is_free
    )
  ) order by p.first_name, p.last_name), '[]')
  from public.profiles p
  where p.role = 'support' and p.is_active and auth.uid() is not null
$$;

create function public.support_detail(p_support uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = p_support and role = 'support';
  if not found or auth.uid() is null then
    raise exception 'SUPPORT_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'id', p.id,
    'name', public.full_name(p),
    'bio', p.bio,
    'rating', public.rating_of(p.id),
    'schedule', public.schedule_of(p.id),
    'reviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'rating', r.rating, 'comment', r.comment,
        'author', public.full_name(a), 'created_at', r.created_at
      ) order by r.created_at desc), '[]')
      from public.reviews r
      join public.profiles a on a.id = r.student_id
      where r.support_id = p.id and not r.is_hidden
    ),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', d::date,
        'closed', public.is_closed(p.id, d::date),
        'free', (select count(*) from public.slots_for(p.id, d::date) s where s.is_free),
        'slots', (select count(*) from public.slots_for(p.id, d::date))
      ) order by d), '[]')
      from generate_series(
        public.local_today() + public.setting_int('booking_min_days_ahead'),
        public.local_today() + public.setting_int('booking_max_days_ahead'),
        interval '1 day'
      ) d
    )
  );
end $$;

create function public.support_slots(p_support uuid, p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'is_free', s.is_free
  ) order by s.starts_at), '[]')
  from public.slots_for(p_support, p_date) s
  where auth.uid() is not null
$$;

create function public.booking_days() returns jsonb
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
    public.local_today() + public.setting_int('booking_min_days_ahead'),
    public.local_today() + public.setting_int('booking_max_days_ahead'),
    interval '1 day'
  ) d
  where auth.uid() is not null
$$;

create function public.day_availability(p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.row_data order by t.free desc, t.name), '[]')
  from (
    select
      public.full_name(p) as name,
      (select count(*) from public.slots_for(p.id, p_date) s where s.is_free) as free,
      jsonb_build_object(
        'id', p.id,
        'name', public.full_name(p),
        'bio', p.bio,
        'rating', public.rating_of(p.id),
        'slots', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'starts_at', s.starts_at, 'ends_at', s.ends_at, 'is_free', s.is_free
          ) order by s.starts_at), '[]')
          from public.slots_for(p.id, p_date) s
        )
      ) as row_data
    from public.profiles p
    where p.role = 'support' and p.is_active and auth.uid() is not null
      and exists (select 1 from public.slots_for(p.id, p_date))
  ) t
$$;

create function public.my_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.booking_json(b) || jsonb_build_object(
      'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment)
                 from public.reviews r where r.booking_id = b.id)
    ) order by b.starts_at desc), '[]')
  from (
    select * from public.bookings x
    where x.student_id = auth.uid()
    order by x.starts_at desc limit 200
  ) b
$$;

create function public.notifications_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body,
    'link', n.link, 'read_at', n.read_at, 'created_at', n.created_at
  ) order by n.created_at desc), '[]')
  from (
    select * from public.notifications x
    where x.user_id = auth.uid()
    order by x.created_at desc limit 100
  ) n
$$;

create function public.notifications_mark_read(p_id uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = public.app_now()
  where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id)
$$;

create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

create function public.support_calendar(p_from date, p_to date, p_support uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_support uuid := coalesce(p_support, auth.uid());
begin
  if not public.is_admin() and (v_support is distinct from auth.uid()
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

create function public.support_home() returns jsonb
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
    'to_mark', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at desc), '[]')
      from public.bookings b
      where b.support_id = v_me and b.lesson_date < v_today and b.status = 'unmarked'
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

create function public.chat_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]')
  from (
    select
      public.booking_json(b) || jsonb_build_object(
        'last_message', (select m.body from public.messages m
                         where m.booking_id = b.id order by m.created_at desc limit 1),
        'unread', (select count(*) from public.messages m
                   where m.booking_id = b.id and m.read_at is null
                     and m.sender_id is distinct from auth.uid()
                     and auth.uid() in (b.student_id, b.support_id))
      ) as row_data,
      coalesce((select max(m.created_at) from public.messages m where m.booking_id = b.id),
               b.created_at) as sort_at
    from public.bookings b
    where (
        auth.uid() in (b.student_id, b.support_id) and (
          b.status = 'booked'
          or exists (select 1 from public.messages m where m.booking_id = b.id)
        )
      ) or (
        public.is_admin() and exists (select 1 from public.messages m where m.booking_id = b.id)
      )
    limit 200
  ) t
$$;

create function public.chat_messages(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_me uuid := auth.uid();
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_me not in (b.student_id, b.support_id) and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if v_me in (b.student_id, b.support_id) then
    update public.messages set read_at = public.app_now()
    where booking_id = p_booking and read_at is null and sender_id is distinct from v_me;
  end if;
  return jsonb_build_object(
    'booking', public.booking_json(b),
    'can_send', b.status = 'booked' and v_me in (b.student_id, b.support_id)
      and public.setting_bool('chat_enabled'),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'sender_id', m.sender_id, 'sender', public.name_of(m.sender_id),
        'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at
      ) order by m.created_at), '[]')
      from public.messages m where m.booking_id = p_booking
    )
  );
end $$;

create function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.local_today();
begin
  perform public.require_admin();
  return jsonb_build_object(
    'today', v_today,
    'students', (select count(*) from public.profiles where role = 'student' and is_active),
    'supports', (select count(*) from public.profiles where role = 'support' and is_active),
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
    'active_bans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id,
        'student_name', public.name_of(x.student_id),
        'ends_at', x.ends_at, 'reason', x.reason
      ) order by x.ends_at), '[]')
      from public.bans x where x.lifted_at is null and x.ends_at > public.app_now()
    ),
    'upcoming_count', (select count(*) from public.bookings b
                       where b.status = 'booked' and b.starts_at > public.app_now())
  );
end $$;

create function public.admin_list_users(p_role public.user_role default null, p_search text default '')
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'role', p.role, 'login', p.login,
      'first_name', p.first_name, 'last_name', p.last_name,
      'birth_year', p.birth_year, 'bio', p.bio, 'is_active', p.is_active,
      'created_at', p.created_at,
      'password_changed_at', p.password_changed_at,
      'strikes', public.active_strikes(p.id),
      'banned_until', (public.active_ban(p.id)).ends_at,
      'lessons', (select count(*) from public.bookings b
                  where (b.student_id = p.id or b.support_id = p.id) and b.status = 'attended'),
      'no_shows', (select count(*) from public.bookings b
                   where b.student_id = p.id and b.status = 'no_show'),
      'rating', case when p.role = 'support' then public.rating_of(p.id) end,
      'schedule', case when p.role = 'support' then public.schedule_of(p.id) end
    ) order by p.first_name, p.last_name), '[]')
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (coalesce(p_search, '') = ''
        or (p.first_name || ' ' || p.last_name || ' ' || p.login) ilike '%' || p_search || '%')
  );
end $$;

create function public.admin_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_admin();
  select * into p from public.profiles where id = p_user;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'profile', to_jsonb(p),
    'bookings', (
      select coalesce(jsonb_agg(public.booking_json(b) order by b.starts_at desc), '[]')
      from public.bookings b where p_user in (b.student_id, b.support_id)
    ),
    'penalties', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]')
      from public.penalties x where x.student_id = p_user
    ),
    'bans', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]')
      from public.bans x where x.student_id = p_user
    ),
    'strikes', public.active_strikes(p_user),
    'schedule', public.schedule_of(p_user),
    'rating', public.rating_of(p_user)
  );
end $$;

create function public.release_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  for b in
    select * from public.bookings x
    where x.support_id = p_user and x.status = 'booked' and x.starts_at > public.app_now()
    for update
  loop
    perform public.displace_booking(b);
  end loop;
  for b in
    update public.bookings set status = 'cancelled', cancel_reason = 'account_removed'
    where student_id = p_user and status in ('booked', 'needs_transfer')
    returning *
  loop
    perform public.notify(b.support_id, 'booking_cancelled', public.booking_vars(b), '/');
  end loop;
end $$;

create function public.admin_release_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  perform public.release_user(p_user);
end $$;

create function public.admin_update_user(
  p_user uuid, p_first text, p_last text, p_birth_year int, p_bio text, p_active boolean
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
      birth_year = p_birth_year, bio = coalesce(p_bio, ''), is_active = p_active
  where id = p_user;
  if p.is_active and not p_active then
    perform public.release_user(p_user);
  end if;
  perform public.log_audit('user.update', 'user', p_user::text,
    jsonb_build_object('name', btrim(p_first) || ' ' || btrim(p_last), 'active', p_active));
end $$;

create function public.admin_set_schedule(p_support uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_hit int := 0;
begin
  perform public.require_admin();
  if not exists (select 1 from public.profiles where id = p_support and role = 'support') then
    raise exception 'SUPPORT_NOT_FOUND';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(weekday int, start_time time, end_time time)
    where r.end_time <= r.start_time or r.weekday not between 1 and 7
  ) then
    raise exception 'SCHEDULE_INVALID';
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

create function public.admin_bookings(
  p_from date, p_to date, p_status public.booking_status default null, p_support uuid default null,
  p_search text default ''
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
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
      order by x.starts_at desc limit 1000
    ) b
  );
end $$;

create function public.admin_penalties() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'bans', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id, 'student_name', public.name_of(x.student_id),
        'starts_at', x.starts_at, 'ends_at', x.ends_at, 'reason', x.reason,
        'lifted_at', x.lifted_at,
        'is_active', x.lifted_at is null and x.ends_at > public.app_now()
      ) order by x.created_at desc), '[]')
      from (select * from public.bans order by created_at desc limit 300) x
    ),
    'penalties', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id, 'student_name', public.name_of(x.student_id),
        'kind', x.kind, 'note', x.note, 'revoked_at', x.revoked_at, 'created_at', x.created_at
      ) order by x.created_at desc), '[]')
      from (select * from public.penalties order by created_at desc limit 300) x
    )
  );
end $$;

create function public.admin_add_ban(p_student uuid, p_hours int, p_reason text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_until timestamptz := public.app_now() + p_hours * interval '1 hour';
begin
  perform public.require_admin();
  if p_hours < 1 then
    raise exception 'BAN_INVALID';
  end if;
  insert into public.bans (student_id, starts_at, ends_at, reason)
  values (p_student, public.app_now(), v_until, coalesce(nullif(btrim(p_reason), ''), 'admin'));
  perform public.notify(p_student, 'ban', jsonb_build_object(
    'date', public.fmt_date(public.app_now()),
    'until', public.fmt_date(v_until) || ' ' || public.fmt_time(v_until)), '/');
  perform public.log_audit('ban.add', 'user', p_student::text,
    jsonb_build_object('name', public.name_of(p_student), 'hours', p_hours, 'reason', p_reason));
end $$;

create function public.admin_lift_ban(p_ban uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.bans;
begin
  perform public.require_admin();
  update public.bans set lifted_at = public.app_now(), lifted_by = auth.uid()
  where id = p_ban and lifted_at is null returning * into x;
  if found then
    perform public.notify(x.student_id, 'ban_lifted', '{}', '/');
    perform public.log_audit('ban.lift', 'user', x.student_id::text,
      jsonb_build_object('name', public.name_of(x.student_id)));
  end if;
end $$;

create function public.admin_revoke_penalty(p_penalty uuid) returns void
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
    perform public.log_audit('penalty.revoke', 'user', x.student_id::text,
      jsonb_build_object('name', public.name_of(x.student_id), 'kind', x.kind));
  end if;
end $$;

create function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment, 'is_hidden', r.is_hidden,
      'student_name', public.name_of(r.student_id), 'support_name', public.name_of(r.support_id),
      'created_at', r.created_at
    ) order by r.created_at desc), '[]')
    from (select * from public.reviews order by created_at desc limit 500) r
  );
end $$;

create function public.admin_set_review_hidden(p_review uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.reviews set is_hidden = p_hidden where id = p_review;
  perform public.log_audit('review.hide', 'review', p_review::text,
    jsonb_build_object('hidden', p_hidden));
end $$;

create function public.admin_delete_review(p_review uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.reviews where id = p_review;
  perform public.log_audit('review.delete', 'review', p_review::text);
end $$;

create function public.admin_closures() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'closed_on', c.closed_on, 'reason', c.reason, 'support_id', c.support_id,
      'start_time', to_char(c.start_time, 'HH24:MI'),
      'end_time', to_char(c.end_time, 'HH24:MI'),
      'support_name', case when c.support_id is null then null
                      else public.name_of(c.support_id) end
    ) order by c.closed_on, c.start_time), '[]')
    from public.schedule_closures c
    where c.closed_on >= public.local_today()
  );
end $$;

create function public.admin_stats(p_from date, p_to date) returns jsonb
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

create function public.admin_month_report(p_month date) returns jsonb
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

create function public.admin_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'settings', (select coalesce(jsonb_agg(to_jsonb(s) order by s.section, s.sort_order), '[]')
                 from public.settings s),
    'templates', (select coalesce(jsonb_agg(to_jsonb(t) order by t.type), '[]')
                  from public.notification_templates t),
    'strings', (select coalesce(jsonb_object_agg(key, value), '{}') from public.ui_strings),
    'announcements', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]')
                      from public.announcements a)
  );
end $$;

create function public.admin_save_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  v_num numeric;
begin
  perform public.require_admin();
  select * into s from public.settings where key = p_key;
  if not found then
    raise exception 'SETTING_NOT_FOUND';
  end if;
  if s.kind = 'int' then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'SETTING_INVALID';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num) or v_num < 0
      or (p_key = 'lesson_minutes' and v_num not between 5 and 240)
      or (p_key = 'reminder_evening_hour' and v_num > 23)
      or (p_key in ('max_active_bookings', 'max_bookings_per_day', 'ban_hours', 'strike_reset_days')
          and v_num < 1) then
      raise exception 'SETTING_INVALID';
    end if;
  elsif s.kind = 'bool' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'SETTING_INVALID';
  elsif s.kind in ('text', 'color', 'image') and jsonb_typeof(p_value) <> 'string' then
    raise exception 'SETTING_INVALID';
  elsif s.kind = 'color' and (p_value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'SETTING_INVALID';
  end if;
  update public.settings set value = p_value where key = p_key;
  perform public.log_audit('setting.update', 'setting', p_key,
    case when s.kind = 'image' then '{}' else
      jsonb_build_object('from', s.value, 'to', p_value) end);
end $$;

create function public.admin_save_template(
  p_type text, p_title text, p_body text, p_enabled boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.notification_templates
  set title = p_title, body = p_body, enabled = p_enabled where type = p_type;
  perform public.log_audit('template.update', 'template', p_type);
end $$;

create function public.admin_save_string(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if coalesce(btrim(p_value), '') = '' then
    delete from public.ui_strings where key = p_key;
  else
    insert into public.ui_strings (key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
  end if;
  perform public.log_audit('text.update', 'text', p_key);
end $$;

create function public.admin_save_announcement(
  p_id uuid, p_title text, p_body text, p_audience text, p_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_id is null then
    insert into public.announcements (title, body, audience, is_active)
    values (p_title, p_body, p_audience, p_active);
  else
    update public.announcements
    set title = p_title, body = p_body, audience = p_audience, is_active = p_active
    where id = p_id;
  end if;
  perform public.log_audit('announcement.save', 'announcement', coalesce(p_id::text, 'new'),
    jsonb_build_object('title', p_title));
end $$;

create function public.admin_delete_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.announcements where id = p_id;
  perform public.log_audit('announcement.delete', 'announcement', p_id::text);
end $$;

create function public.admin_audit(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'entity', a.entity, 'entity_id', a.entity_id,
      'details', a.details, 'created_at', a.created_at,
      'actor', case when a.actor_id is null then 'System' else public.name_of(a.actor_id) end
    ) order by a.id desc), '[]')
    from (select * from public.audit_log order by id desc limit p_limit) a
  );
end $$;

create function public.record_password_change(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid;
begin
  update public.profiles set password_changed_at = public.app_now() where id = p_user;
  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  if v_admin is not null then
    perform public.notify(v_admin, 'password_changed',
      jsonb_build_object('name', public.name_of(p_user)), '/admin/users/' || p_user);
  end if;
end $$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.record_password_change(uuid) to service_role;

grant execute on function public.get_public_config() to anon, authenticated;

grant execute on function
  public.get_me(),
  public.student_home(),
  public.list_supports(),
  public.support_detail(uuid),
  public.support_slots(uuid, date),
  public.booking_days(),
  public.day_availability(date),
  public.book_lesson(uuid, timestamptz, text, uuid),
  public.cancel_booking(uuid, text),
  public.transfer_options(uuid),
  public.accept_transfer(uuid, uuid),
  public.decline_transfer(uuid),
  public.my_history(),
  public.notifications_list(),
  public.notifications_mark_read(uuid),
  public.push_subscribe(text, text, text),
  public.push_unsubscribe(text),
  public.support_home(),
  public.support_calendar(date, date, uuid),
  public.mark_attendance(uuid, public.booking_status),
  public.close_day(uuid, date, text, time, time),
  public.reopen_day(uuid),
  public.chat_list(),
  public.chat_messages(uuid),
  public.send_message(uuid, text),
  public.submit_review(uuid, int, text),
  public.admin_dashboard(),
  public.admin_list_users(public.user_role, text),
  public.admin_user_detail(uuid),
  public.admin_release_user(uuid),
  public.admin_update_user(uuid, text, text, int, text, boolean),
  public.admin_set_schedule(uuid, jsonb),
  public.admin_bookings(date, date, public.booking_status, uuid, text),
  public.admin_penalties(),
  public.admin_add_ban(uuid, int, text),
  public.admin_lift_ban(uuid),
  public.admin_revoke_penalty(uuid),
  public.admin_reviews(),
  public.admin_set_review_hidden(uuid, boolean),
  public.admin_delete_review(uuid),
  public.admin_closures(),
  public.admin_stats(date, date),
  public.admin_month_report(date),
  public.admin_config(),
  public.admin_save_setting(text, jsonb),
  public.admin_save_template(text, text, text, boolean),
  public.admin_save_string(text, text),
  public.admin_save_announcement(uuid, text, text, text, boolean),
  public.admin_delete_announcement(uuid),
  public.admin_audit(int)
to authenticated;
