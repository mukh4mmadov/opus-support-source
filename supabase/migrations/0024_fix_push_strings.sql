insert into public.ui_strings (key, value) values
  ('push.why_manager', 'This is important. Without notifications you may miss important updates.'),
  ('push.manager_1', 'Get notified when students book lessons, when they cancel, reschedule, or need attention.'),
  ('push.manager_2', 'Receive updates about complaints, reviews, and schedule changes.'),
  ('push.manager_3', 'Stay informed about everything happening at your center.')
on conflict (key) do update set value = excluded.value;
