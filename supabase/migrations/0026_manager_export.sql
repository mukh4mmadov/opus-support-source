create or replace function public.admin_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  perform public.require_staff();
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
