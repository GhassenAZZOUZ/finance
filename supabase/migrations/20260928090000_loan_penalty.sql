-- Early-repayment penalty (IRA) of a loan (docs/SPEC.md D22): a fraction of the capital repaid
-- early, optionally capped at a number of months of interest on it. Both null = no penalty.
alter table public.loans
  add column penalty_pct public.rate,
  add column penalty_cap_months smallint check (penalty_cap_months between 0 and 120);
