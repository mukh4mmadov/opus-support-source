insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('staff_attendance_enabled', 'false', 'bool', 'Staff attendance', 'Support teacher attendance',
    'On: support teachers scan the QR on the reception screen when they arrive and leave, then pass a face check. Upload each teacher''s photo and set the center location first. Turn it on in the evening, so the next day starts clean.', false, 10),
  ('staff_center_location', '""', 'text', 'Staff attendance', 'Center location',
    'Latitude, longitude. Easiest: open this page at the center and tap Use this device''s location.', false, 20),
  ('staff_gps_radius', '500', 'int', 'Staff attendance', 'Allowed distance from the center (meters)',
    'A scan farther than this is refused. Indoors a phone''s location can be 100-300 m off.', false, 30),
  ('staff_late_minutes', '5', 'int', 'Staff attendance', 'Late after (minutes)',
    'Arriving more than this after work time starts counts as late.', false, 40),
  ('staff_early_minutes', '0', 'int', 'Staff attendance', 'Leaving early before (minutes)',
    'Leaving more than this before work time ends counts as leaving early.', false, 50),
  ('staff_face_match', '60', 'int', 'Staff attendance', 'Face match needed (%)',
    'How close the face must be to the teacher''s photo. In tests the same person scored about 95% and a different person about 45%. Lower it only if real teachers are refused.', false, 60),
  ('staff_photo_days', '60', 'int', 'Staff attendance', 'Keep face check photos (days)',
    'Older photos are deleted. Arrival and leaving times are kept.', false, 70);

insert into public.notification_templates (type, title, body, description) values
  ('staff_reminder', 'Scan the attendance QR',
    'Your work time started at {{time}}. Scan the QR at reception when you arrive.',
    'Support teacher, when work time started and they have not scanned in'),
  ('staff_late', '{{support}} came late',
    '{{support}} arrived at {{time}}, {{minutes}} min late.',
    'Developer and reception, when a support teacher arrives late'),
  ('staff_absent', '{{support}} did not come',
    '{{support}} did not come on {{date}} (work time {{from}}-{{to}}).',
    'Developer and reception, when a support teacher did not come by the end of work time');

create table public.staff_faces (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  descriptor real[] not null,
  photo text not null,
  updated_at timestamptz not null default public.app_now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create table public.staff_qr_codes (
  code text primary key,
  created_at timestamptz not null,
  used_at timestamptz
);
create index staff_qr_codes_created_idx on public.staff_qr_codes (created_at);

create table public.staff_scans (
  id uuid primary key default gen_random_uuid(),
  support_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('arrive', 'leave')),
  scanned_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  distance_m int not null,
  tries smallint not null default 0,
  done_at timestamptz,
  failed boolean not null default false
);
create index staff_scans_done_idx on public.staff_scans (done_at);

create table public.staff_face_checks (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.staff_scans (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null,
  similarity real not null,
  passed boolean not null,
  real_score real,
  live_score real,
  photo text
);
create index staff_face_checks_support_idx on public.staff_face_checks (support_id, created_at);

create table public.staff_face_hashes (
  hash text primary key
);

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  support_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  expected_start timestamptz,
  expected_end timestamptz,
  arrived_at timestamptz,
  arrive_manual_by uuid references public.profiles (id) on delete set null,
  left_at timestamptz,
  leave_manual_by uuid references public.profiles (id) on delete set null,
  manual_note text not null default '',
  excused boolean not null default false,
  excuse_note text not null default '',
  excused_by uuid references public.profiles (id) on delete set null,
  reminded_at timestamptz,
  absent_alerted_at timestamptz,
  unique (support_id, work_date)
);
create index staff_attendance_date_idx on public.staff_attendance (work_date);

alter table public.staff_faces enable row level security;
alter table public.staff_qr_codes enable row level security;
alter table public.staff_scans enable row level security;
alter table public.staff_face_checks enable row level security;
alter table public.staff_face_hashes enable row level security;
alter table public.staff_attendance enable row level security;
revoke all on public.staff_faces, public.staff_qr_codes, public.staff_scans,
  public.staff_face_checks, public.staff_face_hashes, public.staff_attendance
from anon, authenticated;

create function public.meters_between(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
) returns int
language sql immutable set search_path = '' as $$
  select round(2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ))))::int
$$;

create function public.face_vector(p jsonb) returns real[]
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 128 and 2048
    or exists (select 1 from jsonb_array_elements(p) x where jsonb_typeof(x) <> 'number') then
    return null;
  end if;
  return array(select (x #>> '{}')::real from jsonb_array_elements(p) with ordinality t(x, i) order by i);
exception when others then
  return null;
end $$;

create function public.face_similarity(a real[], b real[]) returns real
language sql immutable set search_path = '' as $$
  select case when cardinality(a) is distinct from cardinality(b) then 0::real else
    greatest(0, least(1, (0.8 - sqrt(25 * sum((x - y) ^ 2)) / 100) / 0.6))::real end
  from unnest(a, b) as t(x, y)
$$;

create function public.staff_expected(p_support uuid, p_date date)
returns table (expected_start timestamptz, expected_end timestamptz)
language sql stable security definer set search_path = '' as $$
  with work as (
    select range_agg(tstzrange(
      (p_date + s.start_time) at time zone public.center_tz(),
      (p_date + s.end_time) at time zone public.center_tz())) as r
    from public.weekly_schedules s
    where s.support_id = p_support and s.weekday = extract(isodow from p_date)
  ), closed as (
    select range_agg(tstzrange(
      case when c.created_by = p_support then greatest(x.from_at, c.created_at) else x.from_at end,
      x.to_at)) as r
    from public.schedule_closures c
    cross join lateral (select
      (p_date + coalesce(c.start_time, time '00:00')) at time zone public.center_tz() as from_at,
      case when c.end_time is null then (p_date + 1)::timestamp at time zone public.center_tz()
           else (p_date + c.end_time) at time zone public.center_tz() end as to_at) x
    where c.closed_on = p_date and (c.support_id is null or c.support_id = p_support)
      and (c.created_by is distinct from p_support or c.created_at < x.to_at)
  ), remaining as (
    select work.r - coalesce(closed.r, '{}'::tstzmultirange) as r from work, closed
  )
  select lower(r), upper(r) from remaining where r is not null and not isempty(r)
$$;

create function public.staff_day_json(a public.staff_attendance) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_over boolean := a.work_date < public.local_today()
    or (a.expected_end is not null and v_now >= a.expected_end);
  v_left timestamptz := a.left_at;
  v_late int := 0;
  v_early int := 0;
  v_status text;
begin
  if a.arrived_at is not null then
    v_late := greatest(0, floor(extract(epoch from a.arrived_at - a.expected_start) / 60)::int);
    if v_left is null and v_over then
      v_left := greatest(a.arrived_at, (
        select max(b.ends_at) from public.bookings b
        where b.support_id = a.support_id and b.lesson_date = a.work_date
          and b.status = 'attended' and b.ends_at <= v_now));
    end if;
    if v_left is not null then
      v_early := greatest(0, floor(extract(epoch from a.expected_end - v_left) / 60)::int);
    end if;
  end if;

  v_status := case
    when a.excused then 'excused'
    when a.arrived_at is null and a.expected_start is null then 'off'
    when a.arrived_at is null and v_over then 'absent'
    when a.arrived_at is null
      and v_now >= a.expected_start + public.setting_int('staff_late_minutes') * interval '1 minute' then 'missing'
    when a.arrived_at is null then 'waiting'
    when a.left_at is null and not v_over then 'here'
    else 'done'
  end;

  return jsonb_build_object(
    'id', a.id,
    'support_id', a.support_id,
    'support_name', public.name_of(a.support_id),
    'work_date', a.work_date,
    'expected_start', a.expected_start,
    'expected_end', a.expected_end,
    'arrived_at', a.arrived_at,
    'left_at', a.left_at,
    'left_estimated', case when a.left_at is null then v_left end,
    'status', v_status,
    'late_minutes', v_late,
    'is_late', a.arrived_at is not null and not a.excused
      and v_late > public.setting_int('staff_late_minutes'),
    'early_minutes', v_early,
    'is_early', v_left is not null and not a.excused
      and v_early > public.setting_int('staff_early_minutes'),
    'no_leave', a.arrived_at is not null and a.left_at is null and v_over,
    'worked_minutes', case when a.arrived_at is not null then greatest(0, floor(extract(epoch from
      coalesce(v_left, v_now) - a.arrived_at) / 60)::int) end,
    'arrive_manual_by', public.name_of(a.arrive_manual_by),
    'leave_manual_by', public.name_of(a.leave_manual_by),
    'manual_note', a.manual_note,
    'excused', a.excused,
    'excuse_note', a.excuse_note,
    'excused_by', public.name_of(a.excused_by),
    'face_checks', (select count(*) from public.staff_face_checks k
      where k.support_id = a.support_id
        and (k.created_at at time zone public.center_tz())::date = a.work_date),
    'face_failed', (select count(*) from public.staff_face_checks k
      where k.support_id = a.support_id and not k.passed
        and (k.created_at at time zone public.center_tz())::date = a.work_date)
  );
end $$;

create function public.staff_day_row(p_support uuid, p_date date) returns public.staff_attendance
language plpgsql security definer set search_path = '' as $$
declare
  a public.staff_attendance;
begin
  insert into public.staff_attendance (support_id, work_date, expected_start, expected_end)
  select p_support, p_date, e.expected_start, e.expected_end
  from (select 1) one left join public.staff_expected(p_support, p_date) e on true
  on conflict (support_id, work_date) do nothing;
  select * into a from public.staff_attendance
  where support_id = p_support and work_date = p_date for update;
  return a;
end $$;

create function public.staff_qr_screen() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  c public.staff_qr_codes;
begin
  perform public.require_staff();
  if not public.setting_bool('staff_attendance_enabled') then
    raise exception 'ATTENDANCE_OFF';
  end if;
  select * into c from public.staff_qr_codes
  where used_at is null and created_at <= v_now and created_at > v_now - interval '10 seconds'
  order by created_at desc limit 1;
  if not found then
    insert into public.staff_qr_codes (code, created_at)
    values (replace(gen_random_uuid()::text, '-', ''), v_now)
    returning * into c;
  end if;
  return jsonb_build_object(
    'code', c.code,
    'seconds_left', greatest(1, 10 - floor(extract(epoch from v_now - c.created_at))::int),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', public.name_of(s.support_id), 'kind', s.kind, 'at', s.scanned_at
      ) order by s.done_at desc), '[]')
      from public.staff_scans s
      where s.done_at > v_now - interval '20 seconds'
    )
  );
end $$;

create function public.staff_scan(
  p_code text, p_lat double precision, p_lng double precision, p_accuracy double precision default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_center text := (select value #>> '{}' from public.settings where key = 'staff_center_location');
  v_dist int;
  v_kind text;
  c public.staff_qr_codes;
  a public.staff_attendance;
  s public.staff_scans;
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  if not public.setting_bool('staff_attendance_enabled') then
    raise exception 'ATTENDANCE_OFF';
  end if;
  if coalesce(v_center, '') !~ '^\s*-?[0-9]+(\.[0-9]+)?\s*,\s*-?[0-9]+(\.[0-9]+)?\s*$' then
    raise exception 'ATTENDANCE_NOT_SET_UP';
  end if;
  if not exists (select 1 from public.staff_faces f where f.user_id = v_me) then
    raise exception 'FACE_NOT_SET';
  end if;
  select * into c from public.staff_qr_codes where code = btrim(coalesce(p_code, '')) for update;
  if not found then
    raise exception 'QR_INVALID';
  end if;
  if c.used_at is not null then
    raise exception 'QR_USED';
  end if;
  if c.created_at < v_now - interval '20 seconds' then
    raise exception 'QR_EXPIRED';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'GPS_NEEDED';
  end if;
  v_dist := public.meters_between(split_part(v_center, ',', 1)::double precision,
    split_part(v_center, ',', 2)::double precision, p_lat, p_lng);
  if v_dist > public.setting_int('staff_gps_radius') then
    raise exception 'TOO_FAR';
  end if;

  select * into a from public.staff_attendance where support_id = v_me and work_date = v_today;
  if a.left_at is not null then
    raise exception 'ATTENDANCE_DONE';
  end if;
  v_kind := case when a.arrived_at is null then 'arrive' else 'leave' end;

  update public.staff_qr_codes set used_at = v_now where code = c.code;
  insert into public.staff_scans (support_id, kind, scanned_at, lat, lng, accuracy, distance_m)
  values (v_me, v_kind, v_now, p_lat, p_lng, p_accuracy, v_dist)
  returning * into s;

  a.expected_end := coalesce(a.expected_end,
    (select e.expected_end from public.staff_expected(v_me, v_today) e));
  return jsonb_build_object(
    'scan', s.id,
    'kind', v_kind,
    'expected_end', a.expected_end,
    'early', v_kind = 'leave' and coalesce(a.expected_end > v_now, false)
  );
end $$;

create function public.staff_face(
  p_scan uuid, p_faces jsonb, p_photo text, p_real real default null, p_live real default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := public.app_now();
  v_sim real := 1;
  v_desc real[];
  v_hash text;
  v_hashes text[] := '{}';
  v_ok boolean;
  v_date date;
  v_late int;
  v_face jsonb;
  s public.staff_scans;
  f public.staff_faces;
  a public.staff_attendance;
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  select * into s from public.staff_scans where id = p_scan for update;
  if not found or s.support_id is distinct from v_me then
    raise exception 'FORBIDDEN';
  end if;
  if s.done_at is not null or s.failed then
    raise exception 'SCAN_CLOSED';
  end if;
  if s.scanned_at < v_now - interval '3 minutes' then
    raise exception 'SCAN_EXPIRED';
  end if;
  select * into f from public.staff_faces where user_id = v_me;
  if not found then
    raise exception 'FACE_NOT_SET';
  end if;
  if jsonb_typeof(p_faces) is distinct from 'array' or jsonb_array_length(p_faces) not between 2 and 4
    or coalesce(length(p_photo), 0) not between 100 and 300000
    or p_photo not like 'data:image/jpeg;base64,%' then
    raise exception 'FACE_INVALID';
  end if;

  for v_face in select value from jsonb_array_elements(p_faces) loop
    v_desc := public.face_vector(v_face);
    if v_desc is null or cardinality(v_desc) <> cardinality(f.descriptor) then
      raise exception 'FACE_INVALID';
    end if;
    v_hash := md5(v_desc::text);
    if v_desc = f.descriptor or v_hash = any(v_hashes)
      or exists (select 1 from public.staff_face_hashes h where h.hash = v_hash) then
      raise exception 'FACE_REPLAY';
    end if;
    v_hashes := v_hashes || v_hash;
    v_sim := least(v_sim, public.face_similarity(v_desc, f.descriptor));
  end loop;
  insert into public.staff_face_hashes (hash) select unnest(v_hashes);

  v_ok := v_sim * 100 >= public.setting_int('staff_face_match');
  insert into public.staff_face_checks
    (scan_id, support_id, created_at, similarity, passed, real_score, live_score, photo)
  values (s.id, v_me, v_now, v_sim, v_ok, p_real, p_live, p_photo);

  if not v_ok then
    update public.staff_scans set tries = tries + 1, failed = tries + 1 >= 3
    where id = s.id returning * into s;
    return jsonb_build_object('ok', false, 'tries_left', greatest(0, 3 - s.tries));
  end if;

  update public.staff_scans set done_at = v_now where id = s.id;
  v_date := (s.scanned_at at time zone public.center_tz())::date;
  a := public.staff_day_row(v_me, v_date);

  if s.kind = 'arrive' then
    if a.arrived_at is not null then
      raise exception 'ATTENDANCE_DONE';
    end if;
    update public.staff_attendance set arrived_at = s.scanned_at where id = a.id returning * into a;
    update public.profiles set present_on = v_date where id = v_me;
    v_late := floor(extract(epoch from a.arrived_at - a.expected_start) / 60)::int;
    if not a.excused and v_late > public.setting_int('staff_late_minutes') then
      perform public.notify(p.id, 'staff_late', jsonb_build_object(
        'support', public.name_of(v_me), 'time', public.fmt_time(a.arrived_at), 'minutes', v_late),
        '/admin/attendance')
      from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
    end if;
  else
    if a.arrived_at is null or a.left_at is not null then
      raise exception 'ATTENDANCE_DONE';
    end if;
    update public.staff_attendance set left_at = s.scanned_at where id = a.id returning * into a;
    update public.profiles set present_on = null where id = v_me;
  end if;

  return jsonb_build_object('ok', true, 'kind', s.kind, 'day', public.staff_day_json(a));
end $$;

create function public.my_staff_attendance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_today date := public.local_today();
  a public.staff_attendance;
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  select * into a from public.staff_attendance where support_id = v_me and work_date = v_today;
  if not found then
    a.support_id := v_me;
    a.work_date := v_today;
    a.excused := false;
    a.manual_note := '';
    a.excuse_note := '';
    select e.expected_start, e.expected_end into a.expected_start, a.expected_end
    from public.staff_expected(v_me, v_today) e;
  end if;
  return jsonb_build_object(
    'enabled', public.setting_bool('staff_attendance_enabled'),
    'face_set', exists (select 1 from public.staff_faces f where f.user_id = v_me),
    'today', public.staff_day_json(a),
    'days', (
      select coalesce(jsonb_agg(public.staff_day_json(x) order by x.work_date desc), '[]')
      from public.staff_attendance x
      where x.support_id = v_me and x.work_date < v_today and x.work_date >= v_today - 30
    )
  );
end $$;

create function public.staff_attendance_list(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_staff();
  if p_from is null and p_to is null then
    p_from := public.local_today();
    p_to := p_from;
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'RANGE_INVALID';
  end if;
  return (
    select coalesce(jsonb_agg(public.staff_day_json(a)
      order by a.work_date desc, p.first_name, p.last_name), '[]')
    from public.staff_attendance a join public.profiles p on p.id = a.support_id
    where a.work_date between p_from and p_to
  );
end $$;

create function public.staff_mark(
  p_support uuid, p_date date, p_arrived time default null, p_left time default null, p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_note text := left(btrim(coalesce(p_note, '')), 300);
  v_arrived timestamptz := (p_date + p_arrived) at time zone public.center_tz();
  v_left timestamptz := (p_date + p_left) at time zone public.center_tz();
  a public.staff_attendance;
begin
  perform public.require_staff();
  if not exists (select 1 from public.profiles p where p.id = p_support and p.role = 'support') then
    raise exception 'FORBIDDEN';
  end if;
  if v_note = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_date is null or p_date > v_today or p_date < v_today - 31
    or (p_arrived is null and p_left is null)
    or v_arrived > v_now or v_left > v_now then
    raise exception 'TIME_INVALID';
  end if;
  a := public.staff_day_row(p_support, p_date);
  if not public.is_admin() and ((v_arrived is not null and a.arrived_at is not null)
      or (v_left is not null and a.left_at is not null)) then
    raise exception 'ATTENDANCE_ALREADY_SET';
  end if;
  if coalesce(v_arrived, a.arrived_at) is null
    or coalesce(v_left, a.left_at) <= coalesce(v_arrived, a.arrived_at) then
    raise exception 'TIME_INVALID';
  end if;

  update public.staff_attendance set
    arrived_at = coalesce(v_arrived, arrived_at),
    arrive_manual_by = case when v_arrived is not null then v_me else arrive_manual_by end,
    left_at = coalesce(v_left, left_at),
    leave_manual_by = case when v_left is not null then v_me else leave_manual_by end,
    manual_note = v_note
  where id = a.id
  returning * into a;

  if p_date = v_today then
    update public.profiles set present_on = case when a.left_at is null then v_today end
    where id = p_support;
  end if;
  perform public.log_audit('attendance.mark', 'profile', p_support::text, jsonb_build_object(
    'support', public.name_of(p_support), 'date', p_date,
    'arrived', to_char(p_arrived, 'HH24:MI'), 'left', to_char(p_left, 'HH24:MI'), 'note', v_note));
  return public.staff_day_json(a);
end $$;

create function public.staff_excuse(p_support uuid, p_date date, p_excused boolean, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := left(btrim(coalesce(p_note, '')), 300);
  a public.staff_attendance;
begin
  perform public.require_staff();
  if not exists (select 1 from public.profiles p where p.id = p_support and p.role = 'support') then
    raise exception 'FORBIDDEN';
  end if;
  if p_excused and v_note = '' then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_date is null or p_date > public.local_today() + 31 then
    raise exception 'TIME_INVALID';
  end if;
  a := public.staff_day_row(p_support, p_date);
  update public.staff_attendance set
    excused = p_excused,
    excuse_note = case when p_excused then v_note else '' end,
    excused_by = case when p_excused then auth.uid() end
  where id = a.id
  returning * into a;
  perform public.log_audit(case when p_excused then 'attendance.excuse' else 'attendance.unexcuse' end,
    'profile', p_support::text, jsonb_build_object(
      'support', public.name_of(p_support), 'date', p_date, 'note', v_note));
  return public.staff_day_json(a);
end $$;

create function public.admin_set_staff_face(p_user uuid, p_descriptor jsonb, p_photo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_desc real[] := public.face_vector(p_descriptor);
begin
  perform public.require_admin();
  if not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'support') then
    raise exception 'FORBIDDEN';
  end if;
  if v_desc is null or coalesce(length(p_photo), 0) not between 100 and 300000
    or p_photo not like 'data:image/jpeg;base64,%' then
    raise exception 'FACE_INVALID';
  end if;
  insert into public.staff_faces (user_id, descriptor, photo, updated_at, updated_by)
  values (p_user, v_desc, p_photo, public.app_now(), auth.uid())
  on conflict (user_id) do update set descriptor = excluded.descriptor, photo = excluded.photo,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.log_audit('attendance.face_set', 'profile', p_user::text,
    jsonb_build_object('support', public.name_of(p_user)));
end $$;

create function public.admin_remove_staff_face(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  delete from public.staff_faces where user_id = p_user;
  perform public.log_audit('attendance.face_remove', 'profile', p_user::text,
    jsonb_build_object('support', public.name_of(p_user)));
end $$;

create function public.admin_staff_face(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (select jsonb_build_object('photo', f.photo, 'updated_at', f.updated_at)
          from public.staff_faces f where f.user_id = p_user);
end $$;

create function public.admin_staff_face_checks(p_support uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'at', k.created_at, 'kind', s.kind, 'similarity', round(k.similarity::numeric, 2),
      'passed', k.passed, 'real', k.real_score, 'live', k.live_score,
      'distance_m', s.distance_m, 'photo', k.photo
    ) order by k.created_at), '[]')
    from public.staff_face_checks k join public.staff_scans s on s.id = k.scan_id
    where k.support_id = p_support
      and (k.created_at at time zone public.center_tz())::date = p_date
  );
end $$;

create function public.staff_attendance_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_late interval := public.setting_int('staff_late_minutes') * interval '1 minute';
  v_reminded int := 0;
  v_absent int := 0;
  a public.staff_attendance;
begin
  update public.staff_face_checks set photo = null
  where photo is not null
    and created_at < v_now - public.setting_int('staff_photo_days') * interval '1 day';
  delete from public.staff_qr_codes where created_at < v_now - interval '1 day';

  if not public.setting_bool('staff_attendance_enabled') then
    return jsonb_build_object('reminded', 0, 'absent', 0);
  end if;

  insert into public.staff_attendance (support_id, work_date, expected_start, expected_end)
  select p.id, v_today, e.expected_start, e.expected_end
  from public.profiles p cross join lateral public.staff_expected(p.id, v_today) e
  where p.role = 'support' and p.is_active and v_now < e.expected_start
  on conflict (support_id, work_date) do nothing;

  update public.staff_attendance x set (expected_start, expected_end) =
    (select e.expected_start, e.expected_end from public.staff_expected(x.support_id, x.work_date) e)
  where x.work_date = v_today;

  for a in
    update public.staff_attendance set reminded_at = v_now
    where work_date = v_today and reminded_at is null and arrived_at is null and not excused
      and expected_start is not null and v_now >= expected_start + v_late and v_now < expected_end
    returning *
  loop
    v_reminded := v_reminded + 1;
    perform public.notify(a.support_id, 'staff_reminder',
      jsonb_build_object('time', public.fmt_time(a.expected_start)), '/attendance');
  end loop;

  for a in
    update public.staff_attendance set absent_alerted_at = v_now
    where work_date = v_today and absent_alerted_at is null and arrived_at is null and not excused
      and expected_end is not null and v_now >= expected_end
    returning *
  loop
    v_absent := v_absent + 1;
    perform public.notify(p.id, 'staff_absent', jsonb_build_object(
      'support', public.name_of(a.support_id), 'date', public.fmt_date(a.expected_start),
      'from', public.fmt_time(a.expected_start), 'to', public.fmt_time(a.expected_end)),
      '/admin/attendance')
    from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
  end loop;

  return jsonb_build_object('reminded', v_reminded, 'absent', v_absent);
end $$;

create or replace function public.set_at_center(p_present boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() is distinct from 'support' then
    raise exception 'FORBIDDEN';
  end if;
  if public.setting_bool('staff_attendance_enabled') then
    raise exception 'ATTENDANCE_BY_SCAN';
  end if;
  update public.profiles set present_on = case when p_present then public.local_today() end
  where id = auth.uid();
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
    'staff_attendance', public.setting_bool('staff_attendance_enabled'),
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
  v_text text;
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
          and v_num < 1)
      or (p_key = 'staff_gps_radius' and v_num not between 50 and 5000)
      or (p_key = 'staff_face_match' and v_num not between 30 and 95)
      or (p_key = 'staff_photo_days' and v_num not between 1 and 365)
      or (p_key in ('staff_late_minutes', 'staff_early_minutes') and v_num > 240) then
      raise exception 'SETTING_INVALID';
    end if;
  elsif s.kind = 'bool' and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'SETTING_INVALID';
  elsif s.kind in ('text', 'color', 'image') and jsonb_typeof(p_value) <> 'string' then
    raise exception 'SETTING_INVALID';
  elsif s.kind = 'color' and (p_value #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'SETTING_INVALID';
  end if;
  if p_key = 'staff_center_location' then
    v_text := btrim(p_value #>> '{}');
    if v_text <> '' and (v_text !~ '^-?[0-9]+(\.[0-9]+)?\s*,\s*-?[0-9]+(\.[0-9]+)?$'
        or split_part(v_text, ',', 1)::numeric not between -90 and 90
        or split_part(v_text, ',', 2)::numeric not between -180 and 180) then
      raise exception 'SETTING_INVALID';
    end if;
    p_value := to_jsonb(regexp_replace(v_text, '\s*,\s*', ', '));
  end if;
  update public.settings set value = p_value where key = p_key;
  perform public.log_audit('setting.update', 'setting', p_key,
    case when s.kind = 'image' then '{}' else
      jsonb_build_object('from', s.value, 'to', p_value) end);
end $$;

create or replace function public.run_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := public.app_now();
  v_today date := public.local_today();
  v_local_hour int := extract(hour from v_now at time zone public.center_tz());
  v_evening int := public.setting_int('reminder_evening_hour');
  v_soon int := public.setting_int('reminder_before_minutes');
  v_mark interval := public.setting_int('mark_after_minutes') * interval '1 minute';
  v_alert interval := public.setting_int('unmarked_alert_minutes') * interval '1 minute';
  v_auto boolean := public.setting_bool('auto_no_show_enabled');
  v_reviews boolean := public.setting_bool('reviews_enabled');
  v_review_days int := public.setting_int('review_days');
  v_review_hour int := public.setting_int('review_reminder_hour');
  v_review_at timestamptz := (v_today + make_interval(hours => v_review_hour))::timestamp
    at time zone public.center_tz();
  v_grace interval := interval '1 hour';
  v_admin uuid;
  v_vars jsonb;
  b public.bookings;
  v_expired int := 0;
  v_unmarked int := 0;
  v_missed int := 0;
  v_alerts int := 0;
  v_reminders int := 0;
  v_review_asks int := 0;
begin
  for b in
    update public.bookings set status = 'cancelled', cancel_reason = 'transfer_expired'
    where status = 'needs_transfer' and starts_at <= v_now
    returning *
  loop
    v_expired := v_expired + 1;
    perform public.notify(b.student_id, 'booking_cancelled', public.booking_vars(b), '/');
  end loop;

  for b in
    update public.bookings set reminded_unmarked_at = v_now
    where status = 'booked' and reminded_unmarked_at is null
      and starts_at + v_alert <= v_now and ends_at + v_mark > v_now
    returning *
  loop
    v_alerts := v_alerts + 1;
    v_vars := public.booking_vars(b)
      || jsonb_build_object('deadline', public.fmt_time(b.ends_at + v_mark));
    perform public.notify(b.support_id, 'unmarked_support', v_vars, '/');
    perform public.notify(b.student_id, 'unmarked_student', v_vars, '/');
  end loop;

  if v_auto then
    for b in
      update public.bookings set status = 'no_show', auto_marked = true, marked_at = v_now
      where status = 'booked' and ends_at + v_mark <= v_now
        and ends_at + v_mark + v_grace > v_now
      returning *
    loop
      v_missed := v_missed + 1;
      perform public.apply_strike(b);
      perform public.notify(b.support_id, 'auto_no_show_support', public.booking_vars(b), '/history');
      perform public.log_audit('booking.auto_no_show', 'booking', b.id::text, jsonb_build_object(
        'student', public.name_of(b.student_id), 'support', public.name_of(b.support_id)));
    end loop;
  end if;

  select id into v_admin from public.profiles where role = 'admin' and is_active limit 1;
  for b in
    update public.bookings set status = 'unmarked'
    where status = 'booked'
      and (lesson_date < v_today or (v_auto and ends_at + v_mark + v_grace <= v_now))
    returning *
  loop
    v_unmarked := v_unmarked + 1;
    perform public.notify(p.id, 'unmarked_alert', public.booking_vars(b), '/admin/bookings')
    from public.profiles p where p.role::text in ('admin', 'manager') and p.is_active;
  end loop;

  if v_local_hour >= v_evening then
    for b in
      update public.bookings set reminded_day_at = v_now
      where status = 'booked' and reminded_day_at is null and lesson_date = v_today + 1
        and created_at < ((v_today + make_interval(hours => v_evening))::timestamp
          at time zone public.center_tz())
      returning *
    loop
      v_reminders := v_reminders + 1;
      perform public.notify(b.student_id, 'reminder_day',
        public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.support_id)), '/');
      perform public.notify(b.support_id, 'reminder_day',
        public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.student_id)), '/');
    end loop;
  end if;

  for b in
    update public.bookings set reminded_soon_at = v_now
    where status = 'booked' and reminded_soon_at is null
      and starts_at > v_now and starts_at <= v_now + v_soon * interval '1 minute'
    returning *
  loop
    v_reminders := v_reminders + 1;
    perform public.notify(b.student_id, 'reminder_soon',
      public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.support_id)), '/');
    perform public.notify(b.support_id, 'reminder_soon',
      public.booking_vars(b) || jsonb_build_object('other', public.name_of(b.student_id)), '/');
  end loop;

  if v_reviews then
    for b in
      update public.bookings x set review_asked_at = v_now
      where x.status = 'attended' and x.review_asked_at is null and x.ends_at <= v_now
        and v_today <= x.lesson_date + v_review_days
        and not exists (select 1 from public.reviews r where r.booking_id = x.id)
      returning *
    loop
      v_review_asks := v_review_asks + 1;
      perform public.notify(b.student_id, 'review_request', public.booking_vars(b)
        || jsonb_build_object('until', public.review_until_text(b)), '/history');
    end loop;

    if v_review_hour > 0 and v_now >= v_review_at then
      for b in
        update public.bookings x set review_reminded_at = v_now
        where x.status = 'attended' and x.review_reminded_at is null
          and x.lesson_date + v_review_days = v_today
          and x.ends_at <= v_review_at - interval '1 hour'
          and not exists (select 1 from public.reviews r where r.booking_id = x.id)
        returning *
      loop
        v_review_asks := v_review_asks + 1;
        perform public.notify(b.student_id, 'review_reminder', public.booking_vars(b)
          || jsonb_build_object('until', public.review_until_text(b)), '/history');
      end loop;
    end if;
  end if;

  return jsonb_build_object('expired', v_expired, 'unmarked', v_unmarked, 'missed', v_missed,
    'alerts', v_alerts, 'reminders', v_reminders, 'review_asks', v_review_asks,
    'staff', public.staff_attendance_maintenance());
end $$;

revoke all on function
  public.meters_between(double precision, double precision, double precision, double precision),
  public.face_vector(jsonb),
  public.face_similarity(real[], real[]),
  public.staff_expected(uuid, date),
  public.staff_day_json(public.staff_attendance),
  public.staff_day_row(uuid, date),
  public.staff_attendance_maintenance(),
  public.staff_qr_screen(),
  public.staff_scan(text, double precision, double precision, double precision),
  public.staff_face(uuid, jsonb, text, real, real),
  public.my_staff_attendance(),
  public.staff_attendance_list(date, date),
  public.staff_mark(uuid, date, time, time, text),
  public.staff_excuse(uuid, date, boolean, text),
  public.admin_set_staff_face(uuid, jsonb, text),
  public.admin_remove_staff_face(uuid),
  public.admin_staff_face(uuid),
  public.admin_staff_face_checks(uuid, date)
from public, anon, authenticated;

grant execute on function
  public.staff_qr_screen(),
  public.staff_scan(text, double precision, double precision, double precision),
  public.staff_face(uuid, jsonb, text, real, real),
  public.my_staff_attendance(),
  public.staff_attendance_list(date, date),
  public.staff_mark(uuid, date, time, time, text),
  public.staff_excuse(uuid, date, boolean, text),
  public.admin_set_staff_face(uuid, jsonb, text),
  public.admin_remove_staff_face(uuid),
  public.admin_staff_face(uuid),
  public.admin_staff_face_checks(uuid, date)
to authenticated;
