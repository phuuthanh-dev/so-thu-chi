-- A non-sensitive database probe for the external availability check.
-- It reads no application data and runs with the caller's permissions.
create or replace function public.app_availability_probe_v1() returns boolean
language sql stable security invoker set search_path = ''
as $$ select true $$;
revoke all on function public.app_availability_probe_v1() from public;
grant execute on function public.app_availability_probe_v1() to anon, authenticated;
notify pgrst, 'reload schema';
