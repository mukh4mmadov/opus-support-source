create function public.app_now() returns timestamptz
language sql stable as $$ select now() $$;

create type public.user_role as enum ('student', 'support', 'admin');

create type public.booking_status as enum (
  'booked', 'needs_transfer', 'attended', 'no_show', 'cancelled', 'support_absent', 'unmarked'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  login text not null unique,
  first_name text not null,
  last_name text not null,
  birth_year int,
  bio text not null default '',
  is_active boolean not null default true,
  password_changed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.account_passwords (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  support_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index weekly_schedules_support_idx on public.weekly_schedules (support_id, weekday);

create table public.schedule_closures (
  id uuid primary key default gen_random_uuid(),
  support_id uuid references public.profiles (id) on delete cascade,
  closed_on date not null,
  start_time time,
  end_time time,
  reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((start_time is null) = (end_time is null)),
  check (end_time > start_time)
);
create unique index schedule_closures_support_uq on public.schedule_closures (support_id, closed_on)
  where support_id is not null and start_time is null;
create unique index schedule_closures_center_uq on public.schedule_closures (closed_on)
  where support_id is null and start_time is null;
create index schedule_closures_day_idx on public.schedule_closures (closed_on);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  lesson_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  topic text not null default '',
  status public.booking_status not null default 'booked',
  cancel_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz,
  reminded_day_at timestamptz,
  reminded_soon_at timestamptz,
  created_at timestamptz not null default public.app_now(),
  check (ends_at > starts_at)
);
create unique index bookings_slot_uq on public.bookings (support_id, starts_at) where status = 'booked';
create index bookings_student_idx on public.bookings (student_id, status);
create index bookings_support_day_idx on public.bookings (support_id, lesson_date);
create index bookings_starts_idx on public.bookings (starts_at);

create table public.penalties (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  kind text not null check (kind in ('warning', 'ban')),
  note text not null default '',
  revoked_at timestamptz,
  created_at timestamptz not null default public.app_now()
);
create index penalties_student_idx on public.penalties (student_id, created_at);

create table public.bans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  penalty_id uuid references public.penalties (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '',
  lifted_at timestamptz,
  lifted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bans_student_idx on public.bans (student_id, ends_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_booking_idx on public.messages (booking_id, created_at);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  support_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_support_idx on public.reviews (support_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table public.notification_templates (
  type text primary key,
  title text not null,
  body text not null,
  enabled boolean not null default true,
  description text not null default ''
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  kind text not null check (kind in ('int', 'bool', 'text', 'color', 'image')),
  section text not null,
  label text not null,
  help text not null default '',
  is_public boolean not null default false,
  sort_order int not null default 0
);

create table public.ui_strings (
  key text primary key,
  value text not null
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all' check (audience in ('all', 'student', 'support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

alter table public.profiles enable row level security;
alter table public.account_passwords enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.schedule_closures enable row level security;
alter table public.bookings enable row level security;
alter table public.penalties enable row level security;
alter table public.bans enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_templates enable row level security;
alter table public.settings enable row level security;
alter table public.ui_strings enable row level security;
alter table public.announcements enable row level security;
alter table public.audit_log enable row level security;

create policy notifications_own_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

create policy messages_participant_read on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_id and auth.uid() in (b.student_id, b.support_id)
    )
  );

grant select on public.notifications, public.messages to authenticated;

insert into public.settings (key, value, kind, section, label, help, is_public, sort_order) values
  ('center_name', '"OPUS Learning Center"', 'text', 'Branding', 'Center name', 'Shown in the header and on the login page.', true, 10),
  ('logo_data_url', '""', 'image', 'Branding', 'Logo', 'Shown in the header and on the login page.', true, 20),
  ('primary_color', '"#294a41"', 'color', 'Branding', 'Main color', 'Header and buttons.', true, 30),
  ('accent_color', '"#39aa00"', 'color', 'Branding', 'Accent color', 'Small highlights. Should match the logo.', true, 35),
  ('center_phone', '""', 'text', 'Branding', 'Phone', 'Shown to students who need help.', true, 40),
  ('center_address', '""', 'text', 'Branding', 'Address', 'Shown to students who need help.', true, 50),
  ('lesson_minutes', '30', 'int', 'Booking', 'Lesson length (minutes)', 'Also the step between slots. Existing bookings keep their length.', false, 10),
  ('booking_min_days_ahead', '1', 'int', 'Booking', 'Earliest booking (days ahead)', '0 allows booking today, 1 starts from tomorrow.', false, 20),
  ('booking_max_days_ahead', '7', 'int', 'Booking', 'Latest booking (days ahead)', 'How far ahead a student can book.', false, 30),
  ('max_active_bookings', '1', 'int', 'Booking', 'Active bookings per student', 'A new booking opens once attendance closes the current one.', false, 40),
  ('max_bookings_per_day', '1', 'int', 'Booking', 'Lessons per student per day', '', false, 50),
  ('topic_required', 'true', 'bool', 'Booking', 'Topic is required', 'The student must write what they want to study.', false, 60),
  ('topic_max_length', '300', 'int', 'Booking', 'Topic max length', '', false, 70),
  ('cancel_days_before', '1', 'int', 'Booking', 'Free cancellation (days before)', '1 means until the end of the day before the lesson.', false, 80),
  ('close_min_days_before', '1', 'int', 'Booking', 'Support closes days ahead (days)', 'How early a support teacher must close a day or hours. The admin can close at any time.', false, 90),
  ('no_show_after_minutes', '10', 'int', 'Attendance', 'No-show allowed after (minutes)', 'The support teacher can mark a no-show this long after the lesson starts.', false, 10),
  ('warnings_before_ban', '1', 'int', 'Attendance', 'Warnings before a ban', 'Strikes that only give a warning.', false, 20),
  ('ban_hours', '24', 'int', 'Attendance', 'Ban length (hours)', '', false, 30),
  ('strike_reset_days', '30', 'int', 'Attendance', 'Strikes expire after (days)', 'Older no-shows stop counting.', false, 40),
  ('transfer_enabled', 'true', 'bool', 'Features', 'Offer another support teacher', 'When a support teacher closes time, offer students a free one.', false, 10),
  ('chat_enabled', 'true', 'bool', 'Features', 'Chat', 'Students can chat with the support teacher of their active booking.', false, 20),
  ('reviews_enabled', 'true', 'bool', 'Features', 'Reviews', 'Students can rate lessons they attended.', false, 30),
  ('reminder_evening_hour', '18', 'int', 'Reminders', 'Day-before reminder hour', 'Local hour (0-23) the reminder is sent the day before.', false, 10),
  ('reminder_before_minutes', '60', 'int', 'Reminders', 'Reminder before the lesson (minutes)', '', false, 20);

insert into public.notification_templates (type, title, body, description) values
  ('booking_confirmed', 'Booking confirmed', 'Your lesson with {{support}} is on {{date}} at {{time}}.', 'Student, after booking'),
  ('booking_new', 'New booking', '{{student}} booked {{date}} at {{time}}. Topic: {{topic}}', 'Support teacher, after a student books'),
  ('booking_cancelled', 'Lesson cancelled', 'The lesson on {{date}} at {{time}} was cancelled.', 'Both sides, after a cancellation'),
  ('reminder_day', 'Lesson tomorrow', 'You have a lesson with {{other}} tomorrow at {{time}}.', 'Both sides, the day before'),
  ('reminder_soon', 'Lesson soon', 'Your lesson with {{other}} starts at {{time}}.', 'Both sides, shortly before the lesson'),
  ('day_closed_transfer', 'Your support teacher is unavailable', '{{support}} is not available on {{date}}. Pick another support for {{time}}.', 'Student, when another support is free'),
  ('day_closed_cancelled', 'Lesson cancelled', '{{support}} is not available on {{date}}, so your lesson at {{time}} was cancelled. You can book again now.', 'Student, when nobody else is free'),
  ('transfer_done', 'Lesson moved', 'Your lesson on {{date}} at {{time}} is now with {{support}}.', 'Student, after a transfer'),
  ('transfer_new', 'New booking', '{{student}} moved to you on {{date}} at {{time}}. Topic: {{topic}}', 'New support teacher, after a transfer'),
  ('warning', 'Warning: missed lesson', 'You missed your lesson on {{date}}. Next time you will be banned from booking.', 'Student, after a no-show warning'),
  ('ban', 'Booking blocked', 'You missed your lesson on {{date}}. You cannot book until {{until}}.', 'Student, after a ban'),
  ('ban_lifted', 'Booking unblocked', 'You can book lessons again.', 'Student, after the admin lifts a ban'),
  ('review_request', 'How was your lesson?', 'Rate your lesson with {{support}}.', 'Student, after attending'),
  ('chat_message', 'New message from {{sender}}', '{{preview}}', 'Other side of a chat'),
  ('password_changed', 'Password changed', '{{name}} changed their password.', 'Admin, when someone changes their password'),
  ('unmarked_alert', 'Attendance not marked', '{{support}} did not mark the lesson with {{student}} on {{date}} at {{time}}.', 'Admin, when a lesson stays unmarked');
