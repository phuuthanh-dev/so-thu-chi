-- Test-only stand-in for pg_cron; production uses the real extension.
create schema cron;
create table cron.jobs(jobname text primary key, schedule text, command text);
create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
begin
  insert into cron.jobs values ($1, $2, $3)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  return 1;
end $$;
