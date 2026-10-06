-- Fix for #100's undo expiry (found with #138): deleting a user from the auth service (dashboard,
-- admin API) cascades to the plan tables, whose statement triggers ran expire_rebase_undo() as the
-- auth service's role, which may not touch plan_rebase_undo: the deletion failed. Without a signed-in
-- user there is no undo copy of « the caller » to expire, so the function now does nothing then (the
-- user's own copy goes with the cascade). In-app account deletion (delete_my_account) was not affected.
-- Revert: re-run the function from 20261005090000_rebase_undo.sql.

create or replace function public.expire_rebase_undo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  delete from public.plan_rebase_undo where user_id = (select auth.uid());
  return null;
end;
$$;
