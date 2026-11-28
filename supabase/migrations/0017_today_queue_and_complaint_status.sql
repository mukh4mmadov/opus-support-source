alter table public.complaints add column seen_at timestamptz;
update public.complaints set seen_at = answered_at where answered_at is not null;

create function public.admin_complaints_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.complaints set seen_at = public.app_now() where seen_at is null;
end $$;

create or replace function public.admin_complaints(p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
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

create or replace function public.admin_answer_complaint(p_complaint uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reply text := left(btrim(coalesce(p_reply, '')), 1000);
  c public.complaints;
  b public.bookings;
begin
  perform public.require_admin();
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

create or replace function public.my_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    public.booking_json(b) || jsonb_build_object(
      'review', (select jsonb_build_object('rating', r.rating, 'comment', r.comment)
                 from public.reviews r where r.booking_id = b.id),
      'complaint', (select jsonb_build_object(
                      'body', c.body, 'reply', c.reply, 'created_at', c.created_at,
                      'seen_at', c.seen_at, 'answered_at', c.answered_at)
                    from public.complaints c
                    where c.booking_id = b.id and c.student_id = auth.uid())
    ) order by b.starts_at desc), '[]')
  from public.bookings b
  where auth.uid() in (b.student_id, b.support_id)
$$;

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

revoke all on function public.admin_complaints_seen() from public, anon, authenticated;
grant execute on function public.admin_complaints_seen() to authenticated;
