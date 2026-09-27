-- Explicit table privileges. Newer Supabase projects do not grant them by default;
-- RLS policies (previous migration) still restrict every row to its owner.

grant select, insert, update, delete on
  public.budget_settings,
  public.budget_lines,
  public.loans,
  public.monthly_actuals,
  public.monthly_actual_loan_balances
to authenticated;

-- Profiles are created by the signup trigger only.
grant select, update, delete on public.profiles to authenticated;

-- Server-side admin (tests, seed): bypasses RLS but still needs table privileges.
grant all on
  public.profiles,
  public.budget_settings,
  public.budget_lines,
  public.loans,
  public.monthly_actuals,
  public.monthly_actual_loan_balances
to service_role;
