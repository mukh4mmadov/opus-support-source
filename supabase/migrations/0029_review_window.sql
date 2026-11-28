insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('review_days', '0', 'int', 'Features', 'Rating stays open (days after the lesson day)',
    '0: students can rate a lesson from when it ends until midnight of the lesson day. 1: until midnight of the next day.', false, 31),
  ('review_alert_rating', '2', 'int', 'Features', 'Low rating alert (stars or fewer)',
    'A rating this low sends a notification to the developer and reception. 0 turns it off.', false, 32),
  ('review_reminder_hour', '20', 'int', 'Reminders', 'Rating reminder hour',
    'Local hour (1-23) when a student who has not rated a lesson is reminded, on the last day rating is open. 0 turns it off.', false, 30);

alter table public.bookings
  add column review_asked_at timestamptz,
  add column review_reminded_at timestamptz;

update public.notification_templates
set body = 'Rate your lesson with {{support}}. You can do it until {{until}}.',
    description = 'Student, when an attended lesson ends'
where type = 'review_request' and body = 'Rate your lesson with {{support}}.';

insert into public.notification_templates (type, title, body, description) values
  ('review_reminder', 'Rate your lesson', 'You have not rated your lesson with {{support}} yet. You can do it until {{until}}.',
    'Student, in the evening of the last day rating is open'),
  ('review_low', 'Low rating: {{rating}} of 5', '{{student}} rated the lesson with {{support}} on {{date}} at {{time}}. Comment: {{comment}}',
    'Developer and reception, when a lesson gets a low rating');

create function public.review_until(b public.bookings) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (b.lesson_date + 1 + public.setting_int('review_days'))::timestamp
    at time zone public.center_tz()
$$;

create function public.review_until_text(b public.bookings) returns text
language sql stable security definer set search_path = '' as $$
  select public.fmt_date(public.review_until(b) - interval '1 minute') || ' '
    || public.fmt_time(public.review_until(b) - interval '1 minute')
$$;

create function public.can_review(b public.bookings) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.setting_bool('reviews_enabled') and b.status = 'attended'
    and public.app_now() >= b.ends_at and public.app_now() < public.review_until(b)
    and not exists (select 1 from public.reviews r where r.booking_id = b.id)
$$;

create or replace function public.submit_review(p_booking uuid, p_rating int, p_comment text default '')
returns public.reviews
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_comment text := left(btrim(coalesce(p_comment, '')), 1000);
  v_alert int := public.setting_int('review_alert_rating');
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
  if v_now < b.ends_at then
    raise exception 'REVIEW_TOO_EARLY';
  end if;
  if v_now >= public.review_until(b) then
    raise exception 'REVIEW_CLOSED';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'RATING_INVALID';
  end if;

  insert into public.reviews (booking_id, student_id, support_id, rating, comment)
  values (b.id, b.student_id, b.support_id, p_rating, v_comment)
  on conflict (booking_id) do nothing
  returning * into r;
  if not found then
    raise exception 'REVIEW_EXISTS';
  end if;

  if p_rating <= v_alert then
    perform public.notify(p.id, 'review_low', public.booking_vars(b) || jsonb_build_object(
      'rating', p_rating, 'comment', coalesce(nullif(v_comment, ''), 'none')), '/admin/reviews')
    from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
  end if;
  return r;
end $$;

create or replace function public.support_detail(p_support uuid) returns jsonb
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
    'reviews', '[]'::jsonb,
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

create or replace function public.my_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.booking_json(b) || jsonb_build_object(
      'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment)
                 from public.reviews r where r.booking_id = b.id and r.student_id = auth.uid()),
      'can_review', b.student_id = auth.uid() and public.can_review(b),
      'review_until', case when b.student_id = auth.uid() and public.can_review(b)
                        then public.review_until(b) end,
      'complaint', (select jsonb_build_object(
                      'body', c.body, 'reply', c.reply, 'created_at', c.created_at,
                      'seen_at', c.seen_at, 'answered_at', c.answered_at)
                    from public.complaints c
                    where c.booking_id = b.id and c.student_id = auth.uid())
    ) order by b.starts_at desc), '[]')
  from public.bookings b
  where auth.uid() in (b.student_id, b.support_id)
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

  select * into v_review from public.bookings b
  where b.student_id = v_me and b.status = 'attended' and public.can_review(b)
  order by b.starts_at desc limit 1;

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
    'pending_review', case when v_review.id is null then null else public.booking_json(v_review)
      || jsonb_build_object('review_until', public.review_until(v_review)) end,
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
    'must_change_password', p.must_change_password,
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
      'ban_days', public.setting_int('ban_days'),
      'reset_days', public.setting_int('strike_reset_days'),
      'instant_minutes', public.setting_int('instant_expire_minutes'),
      'instant_per_day', public.setting_int('instant_per_day'),
      'daily_minutes', public.setting_int('daily_max_minutes'),
      'moves_per_month', public.setting_int('moves_per_month'),
      'review_days', public.setting_int('review_days')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function public.admin_save_setting(p_key text, p_value jsonb) returns void
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
      or (p_key in ('reminder_evening_hour', 'review_reminder_hour') and v_num > 23)
      or (p_key = 'review_alert_rating' and v_num > 5)
      or (p_key = 'review_days' and v_num > 30)
      or (p_key in ('max_active_bookings', 'max_bookings_per_day', 'ban_days', 'strike_reset_days')
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

create or replace function public.mark_attendance(
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

create or replace function public.check_in(p_booking uuid, p_code text) returns text
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
  perform public.log_audit('booking.check_in', 'booking', b.id::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id), 'from', v_old));
  return 'ok';
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
  v_reviews boolean := public.setting_bool('reviews_enabled');
  v_review_days int := public.setting_int('review_days');
  v_review_hour int := public.setting_int('review_reminder_hour');
  v_review_at timestamptz := (v_today + make_interval(hours => v_review_hour))::timestamp
    at time zone public.center_tz();
  v_grace interval := interval '1 hour';
  v_admin uuid;
  v_vars jsonb;
  b public.bookings;
  v_expired int := 0;
  v_unmarked int := 0;
  v_missed int := 0;
  v_alerts int := 0;
  v_reminders int := 0;
  v_review_asks int := 0;
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

  if v_reviews then
    for b in
      update public.bookings x set review_asked_at = v_now
      where x.status = 'attended' and x.review_asked_at is null and x.ends_at <= v_now
        and v_today <= x.lesson_date + v_review_days
        and not exists (select 1 from public.reviews r where r.booking_id = x.id)
      returning *
    loop
      v_review_asks := v_review_asks + 1;
      perform public.notify(b.student_id, 'review_request', public.booking_vars(b)
        || jsonb_build_object('until', public.review_until_text(b)), '/history');
    end loop;

    if v_review_hour > 0 and v_now >= v_review_at then
      for b in
        update public.bookings x set review_reminded_at = v_now
        where x.status = 'attended' and x.review_reminded_at is null
          and x.lesson_date + v_review_days = v_today
          and x.ends_at <= v_review_at - interval '1 hour'
          and not exists (select 1 from public.reviews r where r.booking_id = x.id)
        returning *
      loop
        v_review_asks := v_review_asks + 1;
        perform public.notify(b.student_id, 'review_reminder', public.booking_vars(b)
          || jsonb_build_object('until', public.review_until_text(b)), '/history');
      end loop;
    end if;
  end if;

  return jsonb_build_object('expired', v_expired, 'unmarked', v_unmarked, 'missed', v_missed,
    'alerts', v_alerts, 'reminders', v_reminders, 'review_asks', v_review_asks);
end $$;

revoke all on function
  public.review_until(public.bookings),
  public.review_until_text(public.bookings),
  public.can_review(public.bookings)
from public, anon, authenticated;
