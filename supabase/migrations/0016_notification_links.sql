create function public.notification_link(p_type text, p_link text, p_role text) returns text
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
    when p_role = 'admin' then '/admin'
    else '/'
  end
$$;

create or replace function public.notifications_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'type', n.type, 'title', n.title, 'body', n.body,
    'link', public.notification_link(n.type, n.link, me.role),
    'read_at', n.read_at, 'created_at', n.created_at
  ) order by n.created_at desc), '[]')
  from (
    select * from public.notifications x
    where x.user_id = auth.uid()
    order by x.created_at desc limit 100
  ) n
  cross join (select p.role::text as role from public.profiles p where p.id = auth.uid()) me
$$;

revoke all on function public.notification_link(text, text, text) from public, anon, authenticated;
