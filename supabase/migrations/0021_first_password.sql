alter table public.profiles add column must_change_password boolean not null default false;

create or replace function public.record_password_change(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid;
begin
  update public.profiles
  set password_changed_at = public.app_now(), must_change_password = false
  where id = p_user;
  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  if v_admin is not null then
    perform public.notify(v_admin, 'password_changed',
      jsonb_build_object('name', public.name_of(p_user)), '/admin/users/' || p_user);
  end if;
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
      'ban_hours', public.setting_int('ban_hours'),
      'reset_days', public.setting_int('strike_reset_days'),
      'instant_minutes', public.setting_int('instant_expire_minutes'),
      'instant_per_day', public.setting_int('instant_per_day'),
      'daily_minutes', public.setting_int('daily_max_minutes'),
      'moves_per_month', public.setting_int('moves_per_month')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;
