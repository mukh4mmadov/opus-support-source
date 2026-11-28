create function public.admin_user_extras(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'push_devices', (select count(*) from public.push_subscriptions s where s.user_id = p_user),
    'rebook_from', public.rebook_from(p_user),
    'hidden_from_top', (select p.hidden_from_top from public.profiles p where p.id = p_user)
  );
end $$;

create function public.admin_clear_rebook(p_student uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.bookings set rebook_from = null
  where student_id = p_student and rebook_from is not null;
  perform public.log_audit('user.rebook_open', 'user', p_student::text,
    jsonb_build_object('name', public.name_of(p_student)));
end $$;

create function public.admin_set_ranking_hidden(p_user uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.profiles set hidden_from_top = p_hidden where id = p_user;
  perform public.log_audit('user.ranking', 'user', p_user::text,
    jsonb_build_object('name', public.name_of(p_user), 'hidden', p_hidden));
end $$;

create function public.admin_delete_complaint(p_complaint uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.complaints;
begin
  perform public.require_admin();
  delete from public.complaints where id = p_complaint returning * into c;
  if found then
    perform public.log_audit('complaint.delete', 'complaint', c.id::text,
      jsonb_build_object('student', public.name_of(c.student_id), 'body', c.body));
  end if;
end $$;

create or replace function public.admin_move_booking(
  p_booking uuid, p_support uuid, p_starts_at timestamptz
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_old_support uuid;
  v_end timestamptz;
begin
  perform public.require_admin();
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if b.status not in ('booked', 'needs_transfer') then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if p_starts_at <= public.app_now() then
    raise exception 'DATE_IN_PAST';
  end if;
  v_old_support := b.support_id;
  v_end := p_starts_at + (b.ends_at - b.starts_at);

  update public.bookings set status = 'needs_transfer' where id = p_booking;
  if not public.support_is_free(p_support, p_starts_at, v_end) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    update public.bookings
    set status = 'booked', support_id = p_support, starts_at = p_starts_at, ends_at = v_end,
        lesson_date = (p_starts_at at time zone public.center_tz())::date,
        reminded_day_at = null, reminded_soon_at = null, reminded_unmarked_at = null,
        checkin_tries = 0
    where id = p_booking returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;
  delete from public.checkin_codes where booking_id = p_booking;

  perform public.notify(b.student_id, 'booking_moved', public.booking_vars(b), '/');
  perform public.notify(p_support, 'transfer_new', public.booking_vars(b), '/');
  if v_old_support <> p_support then
    perform public.notify(v_old_support, 'booking_cancelled', public.booking_vars(b), '/');
  end if;
  perform public.log_audit('booking.move', 'booking', p_booking::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(p_support), 'starts_at', p_starts_at));
  return b;
end $$;

create or replace function public.admin_closures(p_past boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
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

create or replace function public.admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.local_today();
begin
  perform public.require_admin();
  return jsonb_build_object(
    'today', v_today,
    'students', (select count(*) from public.profiles where role = 'student' and is_active),
    'supports', (select count(*) from public.profiles where role = 'support' and is_active),
    'open_complaints', (select count(*) from public.complaints where answered_at is null),
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

create or replace function public.admin_list_users(
  p_role public.user_role default null, p_search text default ''
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'role', p.role, 'login', p.login,
      'first_name', p.first_name, 'last_name', p.last_name,
      'birth_year', p.birth_year, 'bio', p.bio, 'phone', p.phone, 'is_active', p.is_active,
      'created_at', p.created_at,
      'archived_at', p.archived_at,
      'password_changed_at', p.password_changed_at,
      'strikes', public.active_strikes(p.id),
      'banned_until', (public.active_ban(p.id)).ends_at,
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
      and (coalesce(p_search, '') = ''
        or (p.first_name || ' ' || p.last_name || ' ' || p.login) ilike '%' || p_search || '%')
  );
end $$;

create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
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
end $$;

revoke all on function
  public.admin_user_extras(uuid),
  public.admin_clear_rebook(uuid),
  public.admin_set_ranking_hidden(uuid, boolean),
  public.admin_delete_complaint(uuid)
from public, anon, authenticated;

grant execute on function
  public.admin_user_extras(uuid),
  public.admin_clear_rebook(uuid),
  public.admin_set_ranking_hidden(uuid, boolean),
  public.admin_delete_complaint(uuid)
to authenticated;
