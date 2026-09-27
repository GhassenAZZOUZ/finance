-- Least privilege (hosted projects grant more by default than the local stack):
-- signed-in users only need select/insert/update/delete through the API, all filtered by RLS.
-- TRUNCATE in particular bypasses RLS.
revoke truncate, references, trigger on
  public.profiles,
  public.budget_settings,
  public.budget_lines,
  public.budget_exceptions,
  public.loans,
  public.monthly_actuals,
  public.monthly_actual_loan_balances
from anon, authenticated;

-- The signup trigger function runs as its owner; it must not be callable through the API (/rpc).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
