-- Run once as project administrator after the migration, using Supabase SQL Editor.
-- Midnight UTC is 07:00 in Asia/Ho_Chi_Minh. Supabase Cron/pg_cron must be enabled.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('nha-minh-recurring', '0 0 * * *', 'select public.run_recurring_ledgers();');
