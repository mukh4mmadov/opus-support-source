insert into public.settings (key, value, kind, section, label, help, is_public, sort_order)
select 'ban_days', '1', 'int', 'Attendance', 'Ban length (days)',
  'After a missed lesson, booking stays closed for the rest of that day and this many whole days. 1: missed on Tuesday, open again on Thursday at 00:00.',
  false, sort_order
from public.settings where key = 'ban_hours';
delete from public.settings where key = 'ban_hours';

create or replace function public.apply_strike(b public.bookings) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_prior int := public.active_strikes(b.student_id);
  v_penalty uuid;
  v_until timestamptz;
begin
  if v_prior < public.setting_int('warnings_before_ban') then
    insert into public.penalties (student_id, booking_id, kind)
    values (b.student_id, b.id, 'warning');
    perform public.notify(b.student_id, 'warning', public.booking_vars(b), '/');
  else
    v_until := (public.local_today() + 1 + public.setting_int('ban_days'))::timestamp at time zone public.center_tz();
    insert into public.penalties (student_id, booking_id, kind)
    values (b.student_id, b.id, 'ban') returning id into v_penalty;
    insert into public.bans (student_id, penalty_id, starts_at, ends_at, reason)
    values (b.student_id, v_penalty, public.app_now(), v_until, 'no_show');
    perform public.notify(b.student_id, 'ban',
      public.booking_vars(b) || jsonb_build_object(
        'until', public.fmt_date(v_until) || ' ' || public.fmt_time(v_until)), '/');
  end if;
end $$;

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
      or (p_key = 'reminder_evening_hour' and v_num > 23)
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
      'moves_per_month', public.setting_int('moves_per_month')
    )
  )
  from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;
