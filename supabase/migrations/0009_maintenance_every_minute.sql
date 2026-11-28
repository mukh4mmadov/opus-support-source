select cron.schedule('opus-maintenance', '* * * * *', 'select public.run_maintenance()');
