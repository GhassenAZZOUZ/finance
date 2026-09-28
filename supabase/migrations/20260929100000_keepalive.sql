-- Keep-alive for the free hosted project (paused after a week without activity): a scheduled
-- workflow calls /rpc/keepalive with the publishable key. It touches no table and returns a constant,
-- so anonymous callers learn nothing.
create function public.keepalive()
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$ select true $$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
