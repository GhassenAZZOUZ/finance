-- Bank overdraft as its own debt kind (docs/SPEC.md D24, issue #28).
-- kind = 'overdraft': principal = balance used (may be 0), monthly_payment = optional fixed
-- repayment (may be 0), credit_limit = authorised amount (> 0). Loans keep their rules.
-- Loans entered by hand as an overdraft (type containing « découvert ») are converted: limit =
-- their current balance, fixed repayment = their old monthly payment.

alter table public.loans
  add column kind text not null default 'loan' check (kind in ('loan', 'overdraft')),
  add column credit_limit numeric(12, 2);

alter table public.loans drop constraint if exists loans_principal_check;
alter table public.loans drop constraint if exists loans_monthly_payment_check;

update public.loans
set kind = 'overdraft', credit_limit = principal
where type ~* 'd[ée]couvert';

-- "is not null" matters: a CHECK passes when it evaluates to NULL.
alter table public.loans add constraint loans_amounts_by_kind check (
  (kind = 'loan' and principal > 0 and monthly_payment > 0 and credit_limit is null)
  or (kind = 'overdraft' and credit_limit is not null and credit_limit > 0 and principal >= 0 and monthly_payment >= 0)
);
