-- Month of the last payment already made when the remaining principal was read (docs/SPEC.md D5c).
-- The app rolls the principal forward with normal payments up to the plan start.
-- Null = the principal is the one at the plan start (previous behaviour).
alter table public.loans add column principal_paid_through_month public.year_month;
