-- Deleting a user from the auth service (dashboard, admin API) failed (found with #138): the cascade
-- runs triggers as the auth service's role, which may not read the app's tables.
-- 1. expire_rebase_undo() (#100) deleted from plan_rebase_undo: without a signed-in user there is no
--    undo copy of « the caller » to expire, so it now does nothing then (the copy goes with the cascade).
-- 2. savings_goals_keep_primary() (tech-debt 6, deferred to commit) read savings_goals: it now runs as
--    its owner; it only checks the goals of the deleted row's user, which are all gone by then.
-- In-app account deletion (delete_my_account, run as the function owner) was not affected.
-- Revert: re-run expire_rebase_undo() from 20261005090000_rebase_undo.sql;
--         alter function public.savings_goals_keep_primary() security invoker;

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

alter function public.savings_goals_keep_primary() security definer;
