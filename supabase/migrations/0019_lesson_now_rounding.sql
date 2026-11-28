create or replace function public.instant_slot(p_support uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select s.starts_at
  from public.slots_for(p_support, public.local_today()) s
  where s.starts_at > public.app_now()
      - public.setting_int('lesson_minutes') * interval '1 minute' / 2
    and s.starts_at < public.app_now()
      + public.setting_int('lesson_minutes') * interval '1 minute'
  order by abs(extract(epoch from s.starts_at - public.app_now())), s.starts_at desc
  limit 1
$$;

revoke all on function public.instant_slot(uuid) from public, anon, authenticated;
