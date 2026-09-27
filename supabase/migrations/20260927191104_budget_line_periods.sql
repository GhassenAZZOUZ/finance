-- Budget lines that apply only from and/or until a given month (docs/SPEC.md D15, issue #1),
-- e.g. rent 850 € until 2027-06 and 1 100 € from 2027-07. Null = no limit (previous behaviour).
alter table public.budget_lines
  add column start_month public.year_month,
  add column end_month public.year_month,
  add constraint budget_lines_period_order check (start_month is null or end_month is null or start_month <= end_month);
