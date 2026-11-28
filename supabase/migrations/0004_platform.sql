create extension if not exists pg_cron;
create extension if not exists pg_net;

alter publication supabase_realtime add table public.messages, public.notifications;

create table public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create function public.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select value from public.app_secrets where key = 'push_url');
  v_secret text := (select value from public.app_secrets where key = 'push_secret');
begin
  if v_url is not null and v_secret is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := jsonb_build_object('notification_id', new.id)
    );
  end if;
  return new;
exception when others then
  return new;
end $$;

revoke all on function public.push_notification() from public, anon, authenticated;

create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.push_notification();

select cron.schedule('opus-maintenance', '*/5 * * * *', 'select public.run_maintenance()');
