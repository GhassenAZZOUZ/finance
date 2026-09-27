-- Optional contract end month of a loan, entered by the user for consistency checks only
-- (docs/SPEC.md D5b). The simulation never uses it.
alter table public.loans add column contract_end_month public.year_month;
