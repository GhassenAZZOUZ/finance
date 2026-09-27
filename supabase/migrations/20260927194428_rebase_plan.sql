-- Re-basing the plan without breaking the history (docs/SPEC.md D16, issue #5).

-- Planned values a check-in was compared with, frozen when it is saved (or before a re-base).
-- Null = older check-in: compared with the current plan, as before.
alter table public.monthly_actuals
  add column planned_debt public.money,
  add column planned_savings public.money,
  add column planned_income public.money,
  add column planned_expenses public.money,
  add column plan_start_month public.year_month;

-- Free savings already available at the plan start (previously always 0).
alter table public.budget_settings
  add column free_savings_existing public.money not null default 0;
