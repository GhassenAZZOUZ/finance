-- Savings interest (issue #35, SPEC D28): an optional yearly rate on each savings goal, the emergency
-- fund and free savings. 0 by default, so existing plans are unchanged.

alter table public.budget_settings
  add column emergency_rate public.rate not null default 0,
  add column free_savings_rate public.rate not null default 0;

alter table public.savings_goals add column rate public.rate not null default 0;

-- save_budget (also used by apply_import): same steps, plus the two savings rates.
create or replace function public.save_budget(p_settings jsonb, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_settings) is distinct from 'object' or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'save_budget: invalid payload' using errcode = '22023';
  end if;

  insert into public.budget_settings as s (
    start_month, emergency_target, emergency_existing, free_savings_existing, risk_free_rate, early_repayment_pct,
    expense_inflation_rate, income_growth_rate, emergency_rate, free_savings_rate
  )
  select r.start_month, r.emergency_target, r.emergency_existing, r.free_savings_existing, r.risk_free_rate, r.early_repayment_pct,
         coalesce(r.expense_inflation_rate, 0), coalesce(r.income_growth_rate, 0),
         coalesce(r.emergency_rate, 0), coalesce(r.free_savings_rate, 0)
  from jsonb_populate_record(null::public.budget_settings, p_settings) r
  on conflict (user_id) do update set
    start_month = excluded.start_month,
    emergency_target = excluded.emergency_target,
    emergency_existing = excluded.emergency_existing,
    free_savings_existing = excluded.free_savings_existing,
    risk_free_rate = excluded.risk_free_rate,
    early_repayment_pct = excluded.early_repayment_pct,
    expense_inflation_rate = excluded.expense_inflation_rate,
    income_growth_rate = excluded.income_growth_rate,
    emergency_rate = excluded.emergency_rate,
    free_savings_rate = excluded.free_savings_rate;

  delete from public.budget_lines l
  where l.id not in (
    select r.id from jsonb_populate_recordset(null::public.budget_lines, p_lines) r where r.id is not null
  );

  insert into public.budget_lines as l (id, category, label, amount, position, start_month, end_month, indexed)
  select r.id, r.category, r.label, r.amount, r.position, r.start_month, r.end_month, coalesce(r.indexed, true)
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is not null
  on conflict (id) do update set
    category = excluded.category,
    label = excluded.label,
    amount = excluded.amount,
    position = excluded.position,
    start_month = excluded.start_month,
    end_month = excluded.end_month,
    indexed = excluded.indexed;

  insert into public.budget_lines (category, label, amount, position, start_month, end_month, indexed)
  select r.category, r.label, r.amount, r.position, r.start_month, r.end_month, coalesce(r.indexed, true)
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is null;
end;
$$;
