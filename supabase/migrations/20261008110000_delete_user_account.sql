-- Back-office account deletion (issue #159, US-16, epic #161): the admin Edge Function deletes a
-- user with the service role, after its own checks (admin, TOTP, typed e-mail, Stripe cancelled).
-- Same deletion as « Supprimer mon compte » (#37, delete_my_account, unchanged and still bound to
-- auth.uid()): the check-in loan balances first (they restrict a loan's deletion, D8), then the auth
-- user, every other table cascading from it. The audit log keeps the id (no foreign key).
-- Revert: drop function public.delete_user_account(uuid);

create function public.delete_user_account(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_user) then
    return false;
  end if;
  delete from public.monthly_actual_loan_balances where user_id = p_user;
  delete from auth.users where id = p_user;
  return true;
end;
$$;

revoke execute on function public.delete_user_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_account(uuid) to service_role;
