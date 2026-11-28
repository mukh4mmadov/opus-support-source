insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('complaint_days', '0', 'int', 'Features', 'Report a problem stays open (days after the lesson day)',
    '0: students can report a problem with a lesson until midnight of the lesson day. 1: until midnight of the next day.', false, 34);

create function public.complaint_until(b public.bookings) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (b.lesson_date + 1 + public.setting_int('complaint_days'))::timestamp
    at time zone public.center_tz()
$$;

create function public.can_complain(b public.bookings) returns boolean
language sql stable security definer set search_path = '' as $$
  select b.status not in ('booked', 'needs_transfer')
    and public.app_now() < public.complaint_until(b)
    and not exists (select 1 from public.complaints c where c.booking_id = b.id)
$$;

create or replace function public.send_complaint(p_booking uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := left(btrim(coalesce(p_body, '')), 1000);
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status in ('booked', 'needs_transfer') then
    raise exception 'COMPLAINT_NOT_YET';
  end if;
  if public.app_now() >= public.complaint_until(b) then
    raise exception 'COMPLAINT_CLOSED';
  end if;
  if v_body = '' then
    raise exception 'COMPLAINT_EMPTY';
  end if;
  insert into public.complaints (booking_id, student_id, body)
  values (b.id, b.student_id, v_body)
  on conflict (booking_id) do nothing;
  if not found then
    raise exception 'COMPLAINT_EXISTS';
  end if;
  perform public.notify(p.id, 'complaint_new', public.booking_vars(b)
    || jsonb_build_object('body', v_body), '/admin/complaints')
  from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
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
      'can_complain', b.student_id = auth.uid() and public.can_complain(b),
      'complaint_until', case when b.student_id = auth.uid() and public.can_complain(b)
                           then public.complaint_until(b) end,
      'complaint', (select jsonb_build_object(
                      'body', c.body, 'reply', c.reply, 'created_at', c.created_at,
                      'seen_at', c.seen_at, 'answered_at', c.answered_at)
                    from public.complaints c
                    where c.booking_id = b.id and c.student_id = auth.uid())
    ) order by b.starts_at desc), '[]')
  from public.bookings b
  where auth.uid() in (b.student_id, b.support_id)
$$;

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
      'review_days', public.setting_int('review_days'),
      'complaint_days', public.setting_int('complaint_days')
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
      or (p_key in ('review_days', 'complaint_days') and v_num > 30)
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

create or replace function public.accept_transfer(p_booking uuid, p_support uuid)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not public.is_admin() and b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'needs_transfer' or b.starts_at <= public.app_now() then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if p_support = b.support_id or not public.support_is_free(p_support, b.starts_at, b.ends_at) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    update public.bookings set status = 'booked', support_id = p_support
    where id = p_booking returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  perform public.notify(b.student_id, 'transfer_done', public.booking_vars(b), '/');
  perform public.notify(p_support, 'transfer_new', public.booking_vars(b), '/');
  return b;
end $$;

revoke all on function
  public.complaint_until(public.bookings),
  public.can_complain(public.bookings)
from public, anon, authenticated;
