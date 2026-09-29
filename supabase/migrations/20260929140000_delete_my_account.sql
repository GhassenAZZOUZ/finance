-- Account deletion (issue #37, SPEC D26): the signed-in user deletes their own auth user; every
-- table of theirs cascades from auth.users. The browser only has the publishable key, so the delete
-- runs as the function owner, and only ever on the caller's own row (auth.uid()).

-- Check-in loan balances restrict the deletion of a loan (archive instead, D8). When the whole
-- account goes, the balances are removed first so the cascade from auth.users cannot hit that rule.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.monthly_actual_loan_balances where user_id = me;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
