create or replace function public.reopen_day(p_closure uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.schedule_closures;
begin
  select * into c from public.schedule_closures where id = p_closure;
  if not found then
    raise exception 'CLOSURE_NOT_FOUND';
  end if;
  if not public.is_staff() then
    if c.support_id is null or c.support_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN';
    end if;
    if c.created_by is distinct from auth.uid() then
      raise exception 'CLOSED_BY_CENTER';
    end if;
  end if;
  delete from public.schedule_closures where id = p_closure;
  perform public.log_audit('day.reopen', 'closure', c.closed_on::text,
    jsonb_build_object('support', c.support_id));
end $$;

create or replace function public.support_home() returns jsonb
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
    'closures', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'closed_on', c.closed_on, 'reason', c.reason,
        'start_time', to_char(c.start_time, 'HH24:MI'),
        'end_time', to_char(c.end_time, 'HH24:MI'),
        'can_reopen', c.created_by is not distinct from v_me
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
