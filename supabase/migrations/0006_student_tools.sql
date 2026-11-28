create table public.favorite_supports (
  student_id uuid not null references public.profiles (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (student_id, support_id)
);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (student_id, support_id, starts_at)
);
create index waitlist_slot_idx on public.waitlist (support_id, starts_at);

alter table public.favorite_supports enable row level security;
alter table public.waitlist enable row level security;

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('reschedule_enabled', 'true', 'bool', 'Features', 'Students can move a lesson', 'Allowed while free cancellation is still open.', false, 40),
  ('waitlist_enabled', 'true', 'bool', 'Features', 'Waiting list', 'Students can wait for a taken time and are told when it frees up.', false, 50),
  ('waitlist_max', '3', 'int', 'Booking', 'Waiting list places per student', '', false, 100);

insert into public.notification_templates (type, title, body, description) values
  ('waitlist_free', 'A time just opened', '{{support}} is free on {{date}} at {{time}}. Book it before someone else does.', 'Student on the waiting list, when the time frees up'),
  ('lesson_rescheduled', 'Lesson moved', '{{student}} moved their lesson. It was on {{date}} at {{time}}.', 'Support teacher, when a student moves away from their time');

create function public.booking_options() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reschedule_enabled', public.setting_bool('reschedule_enabled'),
    'waitlist_enabled', public.setting_bool('waitlist_enabled'),
    'favorites', (select coalesce(jsonb_agg(f.support_id), '[]')
                  from public.favorite_supports f where f.student_id = auth.uid())
  )
  where auth.uid() is not null
$$;

create function public.toggle_favorite(p_support uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.profiles where id = p_support and role = 'support') then
    raise exception 'SUPPORT_NOT_FOUND';
  end if;
  delete from public.favorite_supports where student_id = auth.uid() and support_id = p_support;
  if found then
    return false;
  end if;
  insert into public.favorite_supports (student_id, support_id) values (auth.uid(), p_support);
  return true;
end $$;

create or replace function public.day_availability(p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(t.row_data order by t.free desc, t.name), '[]')
  from (
    select
      public.full_name(p) as name,
      (select count(*) from public.slots_for(p.id, p_date) s where s.is_free) as free,
      jsonb_build_object(
        'id', p.id,
        'name', public.full_name(p),
        'bio', p.bio,
        'rating', public.rating_of(p.id),
        'slots', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'is_free', s.is_free,
            'can_wait', not s.is_free and s.starts_at > public.app_now()
              and not public.is_blocked(p.id, s.starts_at, s.ends_at),
            'waiting', exists (
              select 1 from public.waitlist w
              where w.student_id = auth.uid() and w.support_id = p.id and w.starts_at = s.starts_at
            )
          ) order by s.starts_at), '[]')
          from public.slots_for(p.id, p_date) s
        )
      ) as row_data
    from public.profiles p
    where p.role = 'support' and p.is_active and auth.uid() is not null
      and exists (select 1 from public.slots_for(p.id, p_date))
  ) t
$$;

create function public.join_waitlist(p_support uuid, p_starts_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_date date := (p_starts_at at time zone public.center_tz())::date;
  v_today date := public.local_today();
begin
  if public.my_role() is distinct from 'student' then
    raise exception 'FORBIDDEN';
  end if;
  if not public.setting_bool('waitlist_enabled') then
    raise exception 'WAITLIST_DISABLED';
  end if;
  if (public.active_ban(v_me)).id is not null then
    raise exception 'STUDENT_BANNED';
  end if;
  if v_date < v_today + public.setting_int('booking_min_days_ahead')
    or v_date > v_today + public.setting_int('booking_max_days_ahead') then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;
  if not exists (
    select 1 from public.slots_for(p_support, v_date) s
    where s.starts_at = p_starts_at and not s.is_free
      and not public.is_blocked(p_support, s.starts_at, s.ends_at)
  ) then
    raise exception 'WAITLIST_NOT_NEEDED';
  end if;

  delete from public.waitlist where student_id = v_me and starts_at <= public.app_now();
  if (select count(*) from public.waitlist where student_id = v_me)
      >= public.setting_int('waitlist_max') then
    raise exception 'WAITLIST_FULL';
  end if;
  insert into public.waitlist (student_id, support_id, starts_at)
  values (v_me, p_support, p_starts_at)
  on conflict (student_id, support_id, starts_at) do nothing;
end $$;

create function public.leave_waitlist(p_support uuid, p_starts_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  delete from public.waitlist
  where student_id = auth.uid() and support_id = p_support and starts_at = p_starts_at
$$;

create function public.notify_waitlist() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  w public.waitlist;
begin
  if old.starts_at <= public.app_now()
    or not public.support_is_free(old.support_id, old.starts_at, old.ends_at) then
    return null;
  end if;
  for w in
    delete from public.waitlist
    where support_id = old.support_id and starts_at = old.starts_at
    returning *
  loop
    if (select count(*) from public.bookings b
        where b.student_id = w.student_id and b.status in ('booked', 'needs_transfer'))
        < public.setting_int('max_active_bookings')
      and (public.active_ban(w.student_id)).id is null then
      perform public.notify(w.student_id, 'waitlist_free', public.booking_vars(old), '/book');
    end if;
  end loop;
  return null;
end $$;

create constraint trigger bookings_slot_freed
  after update on public.bookings
  deferrable initially deferred
  for each row
  when (old.status = 'booked' and (
    new.status <> 'booked' or new.starts_at <> old.starts_at or new.support_id <> old.support_id
  ))
  execute function public.notify_waitlist();

create constraint trigger bookings_slot_deleted
  after delete on public.bookings
  deferrable initially deferred
  for each row
  when (old.status = 'booked')
  execute function public.notify_waitlist();

create function public.reschedule_booking(
  p_booking uuid, p_support uuid, p_starts_at timestamptz
) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_old public.bookings;
  v_date date := (p_starts_at at time zone public.center_tz())::date;
  v_today date := public.local_today();
  v_end timestamptz;
begin
  if not public.setting_bool('reschedule_enabled') then
    raise exception 'RESCHEDULE_DISABLED';
  end if;
  select * into b from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if b.student_id is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if b.status <> 'booked' then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if v_today > b.lesson_date - public.setting_int('cancel_days_before') then
    raise exception 'CANCEL_TOO_LATE';
  end if;
  if (public.active_ban(b.student_id)).id is not null then
    raise exception 'STUDENT_BANNED';
  end if;
  if v_date < v_today + public.setting_int('booking_min_days_ahead')
    or v_date > v_today + public.setting_int('booking_max_days_ahead') then
    raise exception 'DATE_OUT_OF_RANGE';
  end if;
  if p_support = b.support_id and p_starts_at = b.starts_at then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
  if (select count(*) from public.bookings x
      where x.student_id = b.student_id and x.lesson_date = v_date and x.id <> b.id
        and x.status not in ('cancelled', 'support_absent'))
      >= public.setting_int('max_bookings_per_day') then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  v_old := b;
  update public.bookings set status = 'needs_transfer' where id = p_booking;
  select s.ends_at into v_end
  from public.slots_for(p_support, v_date) s
  where s.starts_at = p_starts_at and s.is_free;
  if v_end is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  begin
    update public.bookings
    set status = 'booked', support_id = p_support, starts_at = p_starts_at, ends_at = v_end,
        lesson_date = v_date, reminded_day_at = null, reminded_soon_at = null
    where id = p_booking returning * into b;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  perform public.notify(b.student_id, 'booking_confirmed', public.booking_vars(b), '/');
  perform public.notify(p_support, 'booking_new', public.booking_vars(b), '/');
  perform public.notify(v_old.support_id, 'lesson_rescheduled', public.booking_vars(v_old), '/');
  return b;
end $$;

create function public.admin_waitlist() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'student_name', public.name_of(w.student_id),
      'support_name', public.name_of(w.support_id), 'starts_at', w.starts_at,
      'created_at', w.created_at
    ) order by w.starts_at, w.created_at), '[]')
    from public.waitlist w
    where w.starts_at > public.app_now()
  );
end $$;

create function public.admin_remove_waitlist(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.waitlist where id = p_id;
  perform public.log_audit('waitlist.remove', 'waitlist', p_id::text);
end $$;

revoke all on function
  public.booking_options(),
  public.toggle_favorite(uuid),
  public.join_waitlist(uuid, timestamptz),
  public.leave_waitlist(uuid, timestamptz),
  public.notify_waitlist(),
  public.reschedule_booking(uuid, uuid, timestamptz),
  public.admin_waitlist(),
  public.admin_remove_waitlist(uuid)
from public, anon, authenticated;

grant execute on function
  public.booking_options(),
  public.toggle_favorite(uuid),
  public.join_waitlist(uuid, timestamptz),
  public.leave_waitlist(uuid, timestamptz),
  public.reschedule_booking(uuid, uuid, timestamptz),
  public.admin_waitlist(),
  public.admin_remove_waitlist(uuid)
to authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.notifications, public.messages to authenticated;
