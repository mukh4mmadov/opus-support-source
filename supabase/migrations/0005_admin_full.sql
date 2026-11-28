alter table public.profiles add column archived_at timestamptz;

alter table public.messages
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id) on delete set null;

insert into public.notification_templates (type, title, body, description) values
  ('booking_moved', 'Lesson moved', 'Your lesson is now with {{support}} on {{date}} at {{time}}.', 'Student, after the admin moves a lesson');

create or replace function public.chat_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_data order by sort_at desc), '[]')
  from (
    select
      public.booking_json(b) || jsonb_build_object(
        'last_message', (select m.body from public.messages m
                         where m.booking_id = b.id and m.deleted_at is null
                         order by m.created_at desc limit 1),
        'unread', (select count(*) from public.messages m
                   where m.booking_id = b.id and m.read_at is null and m.deleted_at is null
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
    order by sort_at desc
    limit 1000
  ) t
$$;

create or replace function public.chat_messages(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_me uuid := auth.uid();
  v_admin boolean := public.is_admin();
begin
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_me not in (b.student_id, b.support_id) and not v_admin then
    raise exception 'FORBIDDEN';
  end if;
  if v_me in (b.student_id, b.support_id) then
    update public.messages set read_at = public.app_now()
    where booking_id = p_booking and read_at is null and sender_id is distinct from v_me;
  end if;
  return jsonb_build_object(
    'booking', public.booking_json(b),
    'can_send', v_admin or (b.status = 'booked' and v_me in (b.student_id, b.support_id)
      and public.setting_bool('chat_enabled')),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'sender_id', m.sender_id,
        'sender', case when p.role = 'admin' then 'Admin' else public.full_name(p) end,
        'from_admin', p.role = 'admin',
        'body', m.body, 'created_at', m.created_at, 'read_at', m.read_at,
        'deleted_at', m.deleted_at
      ) order by m.created_at), '[]')
      from public.messages m
      left join public.profiles p on p.id = m.sender_id
      where m.booking_id = p_booking and (v_admin or m.deleted_at is null)
    )
  );
end $$;

create function public.admin_send_message(p_booking uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_body text := btrim(coalesce(p_body, ''));
  m public.messages;
  v_vars jsonb;
begin
  perform public.require_admin();
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_body = '' or length(v_body) > 2000 then
    raise exception 'MESSAGE_INVALID';
  end if;
  insert into public.messages (booking_id, sender_id, body)
  values (p_booking, auth.uid(), v_body) returning * into m;
  v_vars := jsonb_build_object('sender', 'Admin', 'preview', left(v_body, 100));
  perform public.notify(b.student_id, 'chat_message', v_vars, '/chat/' || p_booking);
  perform public.notify(b.support_id, 'chat_message', v_vars, '/chat/' || p_booking);
  perform public.log_audit('chat.send', 'booking', p_booking::text,
    jsonb_build_object('student', public.name_of(b.student_id), 'support', public.name_of(b.support_id)));
  return m;
end $$;

create function public.admin_delete_message(p_message uuid, p_deleted boolean default true)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
begin
  perform public.require_admin();
  update public.messages
  set deleted_at = case when p_deleted then public.app_now() end,
      deleted_by = case when p_deleted then auth.uid() end
  where id = p_message returning * into m;
  if not found then
    raise exception 'MESSAGE_NOT_FOUND';
  end if;
  perform public.log_audit(case when p_deleted then 'chat.delete' else 'chat.restore' end,
    'booking', m.booking_id::text,
    jsonb_build_object('sender', public.name_of(m.sender_id), 'text', left(m.body, 200)));
end $$;

create function public.admin_send_notice(
  p_audience text, p_user uuid, p_title text, p_body text
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform public.require_admin();
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_body), '') = '' then
    raise exception 'MESSAGE_INVALID';
  end if;
  insert into public.notifications (user_id, type, title, body)
  select p.id, 'admin_notice', btrim(p_title), btrim(p_body)
  from public.profiles p
  where p.is_active and p.role <> 'admin' and (
    (p_audience = 'one' and p.id = p_user)
    or p_audience = 'all'
    or (p_audience = 'student' and p.role = 'student')
    or (p_audience = 'support' and p.role = 'support')
  );
  get diagnostics v_count = row_count;
  perform public.log_audit('notice.send', 'notification', p_audience, jsonb_build_object(
    'title', p_title, 'to', coalesce(public.name_of(p_user), p_audience), 'people', v_count));
  return v_count;
end $$;

create function public.admin_notifications(p_limit int default 200, p_user uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body,
      'to', public.name_of(n.user_id), 'read_at', n.read_at, 'created_at', n.created_at
    ) order by n.created_at desc), '[]')
    from (
      select * from public.notifications x
      where p_user is null or x.user_id = p_user
      order by x.created_at desc limit p_limit
    ) n
  );
end $$;

create function public.admin_set_archived(p_user uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  perform public.require_admin();
  select * into p from public.profiles where id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
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
      'birth_year', p.birth_year, 'bio', p.bio, 'is_active', p.is_active,
      'created_at', p.created_at,
      'archived_at', p.archived_at,
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

create or replace function public.admin_user_detail(p_user uuid) returns jsonb
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
    'reviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'rating', r.rating, 'comment', r.comment, 'is_hidden', r.is_hidden,
        'student_name', public.name_of(r.student_id), 'support_name', public.name_of(r.support_id),
        'created_at', r.created_at
      ) order by r.created_at desc), '[]')
      from public.reviews r where p_user in (r.student_id, r.support_id)
    ),
    'chats', (
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
    ),
    'strikes', public.active_strikes(p_user),
    'schedule', public.schedule_of(p_user),
    'rating', public.rating_of(p_user)
  );
end $$;

drop function public.admin_bookings(date, date, public.booking_status, uuid, text);

create function public.admin_bookings(
  p_from date, p_to date, p_status public.booking_status default null, p_support uuid default null,
  p_search text default '', p_limit int default 200
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
      order by x.starts_at desc limit p_limit
    ) b
  );
end $$;

create function public.admin_update_booking(p_booking uuid, p_topic text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.bookings set topic = btrim(coalesce(p_topic, '')) where id = p_booking;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  perform public.log_audit('booking.edit', 'booking', p_booking::text,
    jsonb_build_object('topic', p_topic));
end $$;

create function public.admin_move_booking(
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
        reminded_day_at = null, reminded_soon_at = null
    where id = p_booking returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  perform public.notify(b.student_id, 'booking_moved', public.booking_vars(b), '/');
  perform public.notify(p_support, 'transfer_new', public.booking_vars(b), '/');
  if v_old_support <> p_support then
    perform public.notify(v_old_support, 'booking_cancelled', public.booking_vars(b), '/');
  end if;
  perform public.log_audit('booking.move', 'booking', p_booking::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(p_support), 'starts_at', p_starts_at));
  return b;
end $$;

create function public.admin_delete_booking(p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  perform public.require_admin();
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  perform public.revoke_strike(p_booking);
  delete from public.bookings where id = p_booking;
  perform public.log_audit('booking.delete', 'booking', p_booking::text, jsonb_build_object(
    'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id),
    'starts_at', b.starts_at, 'status', b.status, 'topic', b.topic));
end $$;

create function public.admin_add_warning(p_student uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := coalesce(nullif(btrim(p_note), ''), 'Warning from the center.');
begin
  perform public.require_admin();
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'USER_NOT_FOUND';
  end if;
  insert into public.penalties (student_id, kind, note) values (p_student, 'warning', v_note);
  insert into public.notifications (user_id, type, title, body, link)
  values (p_student, 'warning', 'Warning', v_note, '/');
  perform public.log_audit('penalty.add', 'user', p_student::text,
    jsonb_build_object('name', public.name_of(p_student), 'note', v_note));
end $$;

create function public.admin_update_ban(p_ban uuid, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  x public.bans;
begin
  perform public.require_admin();
  select * into x from public.bans where id = p_ban for update;
  if not found or p_ends_at <= x.starts_at then
    raise exception 'BAN_INVALID';
  end if;
  update public.bans set ends_at = p_ends_at where id = p_ban;
  perform public.log_audit('ban.update', 'user', x.student_id::text,
    jsonb_build_object('name', public.name_of(x.student_id), 'until', p_ends_at));
end $$;

drop function public.admin_penalties();

create function public.admin_penalties(p_limit int default 300) returns jsonb
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
      from (select * from public.bans order by created_at desc limit p_limit) x
    ),
    'penalties', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'student_id', x.student_id, 'student_name', public.name_of(x.student_id),
        'kind', x.kind, 'note', x.note, 'revoked_at', x.revoked_at, 'created_at', x.created_at
      ) order by x.created_at desc), '[]')
      from (select * from public.penalties order by created_at desc limit p_limit) x
    )
  );
end $$;

drop function public.admin_reviews();

create function public.admin_reviews(p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment, 'is_hidden', r.is_hidden,
      'student_name', public.name_of(r.student_id), 'support_name', public.name_of(r.support_id),
      'created_at', r.created_at
    ) order by r.created_at desc), '[]')
    from (select * from public.reviews order by created_at desc limit p_limit) r
  );
end $$;

create function public.admin_update_review(p_review uuid, p_rating int, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if p_rating not between 1 and 5 then
    raise exception 'RATING_INVALID';
  end if;
  update public.reviews set rating = p_rating, comment = coalesce(p_comment, '') where id = p_review;
  perform public.log_audit('review.edit', 'review', p_review::text,
    jsonb_build_object('rating', p_rating));
end $$;

drop function public.admin_closures();

create function public.admin_closures(p_past boolean default false) returns jsonb
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
    ) order by c.closed_on desc, c.start_time), '[]')
    from public.schedule_closures c
    where p_past or c.closed_on >= public.local_today()
  );
end $$;

create function public.admin_pairs(p_from date, p_to date) returns jsonb
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
        count(*) filter (where b.status = 'booked') as upcoming,
        max(b.lesson_date) as last_lesson
      from public.bookings b
      where b.lesson_date between p_from and p_to and b.status <> 'cancelled'
      group by b.support_id, b.student_id
    ) t
  );
end $$;

create function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'People', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'role', p.role, 'first_name', p.first_name, 'last_name', p.last_name, 'login', p.login,
        'birth_year', p.birth_year, 'active', p.is_active, 'archived_at', p.archived_at,
        'password_changed_at', p.password_changed_at, 'created_at', p.created_at
      ) order by p.role, p.first_name), '[]')
      from public.profiles p
    ),
    'Lessons', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', b.lesson_date, 'starts_at', b.starts_at, 'student', public.name_of(b.student_id),
        'support', public.name_of(b.support_id), 'topic', b.topic, 'status', b.status,
        'cancel_reason', b.cancel_reason, 'created_at', b.created_at
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
        'from', c.start_time, 'to', c.end_time, 'reason', c.reason
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
  public.admin_send_message(uuid, text),
  public.admin_delete_message(uuid, boolean),
  public.admin_send_notice(text, uuid, text, text),
  public.admin_notifications(int, uuid),
  public.admin_set_archived(uuid, boolean),
  public.admin_bookings(date, date, public.booking_status, uuid, text, int),
  public.admin_update_booking(uuid, text),
  public.admin_move_booking(uuid, uuid, timestamptz),
  public.admin_delete_booking(uuid),
  public.admin_add_warning(uuid, text),
  public.admin_update_ban(uuid, timestamptz),
  public.admin_penalties(int),
  public.admin_reviews(int),
  public.admin_update_review(uuid, int, text),
  public.admin_closures(boolean),
  public.admin_pairs(date, date),
  public.admin_export()
from public, anon, authenticated;

grant execute on function
  public.admin_send_message(uuid, text),
  public.admin_delete_message(uuid, boolean),
  public.admin_send_notice(text, uuid, text, text),
  public.admin_notifications(int, uuid),
  public.admin_set_archived(uuid, boolean),
  public.admin_bookings(date, date, public.booking_status, uuid, text, int),
  public.admin_update_booking(uuid, text),
  public.admin_move_booking(uuid, uuid, timestamptz),
  public.admin_delete_booking(uuid),
  public.admin_add_warning(uuid, text),
  public.admin_update_ban(uuid, timestamptz),
  public.admin_penalties(int),
  public.admin_reviews(int),
  public.admin_update_review(uuid, int, text),
  public.admin_closures(boolean),
  public.admin_pairs(date, date),
  public.admin_export()
to authenticated;
