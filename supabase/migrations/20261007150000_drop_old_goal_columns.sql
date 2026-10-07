-- Tech-debt 6.2 (owner go 2026-10-07): the old moving-fund columns, unused since the goals were
-- unified (20260930090000, tech-debt 6), are dropped with the rollback of that migration. The primary
-- goal and its balances live in savings_goals / monthly_actual_goal_balances; nothing reads these.
-- DESTRUCTIVE: the old copies are lost (they only duplicated data moved on 2026-09-30).
-- Revert: none (restore from a backup taken before this migration if ever needed).

-- 1. save_actual no longer writes monthly_actuals.moving_savings (same signature, body only).
create or replace function public.save_actual(
  p_actual jsonb, p_loan_balances jsonb, p_goal_balances jsonb, p_lines jsonb, p_deposits jsonb, p_statements jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  -- Frozen planned values are only written when given; otherwise the saved ones are kept (SPEC D16).
  v_frozen boolean := coalesce(p_actual ? 'planned_debt', false);
begin
  if jsonb_typeof(p_actual) is distinct from 'object'
     or jsonb_typeof(p_loan_balances) is distinct from 'array'
     or jsonb_typeof(p_goal_balances) is distinct from 'array'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_typeof(p_deposits) is distinct from 'array'
     or jsonb_typeof(p_statements) not in ('array', 'null') then
    raise exception 'save_actual: invalid payload' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(
      p_loan_balances || p_goal_balances || p_lines || p_deposits
      || case when jsonb_typeof(p_statements) = 'array' then p_statements else '[]'::jsonb end
    ) b
    where jsonb_typeof(b) <> 'object'
  ) then
    raise exception 'save_actual: invalid row' using errcode = '22023';
  end if;

  insert into public.monthly_actuals as a (
    month, income, expenses, emergency_savings, free_savings,
    planned_debt, planned_savings, planned_income, planned_expenses, plan_start_month
  )
  values (
    (p_actual ->> 'month')::public.year_month,
    (p_actual ->> 'income')::public.money,
    (p_actual ->> 'expenses')::public.money,
    (p_actual ->> 'emergency_savings')::public.money,
    (p_actual ->> 'free_savings')::public.money,
    (p_actual ->> 'planned_debt')::public.money,
    (p_actual ->> 'planned_savings')::public.money,
    (p_actual ->> 'planned_income')::public.money,
    (p_actual ->> 'planned_expenses')::public.money,
    (p_actual ->> 'plan_start_month')::public.year_month
  )
  on conflict (user_id, month) do update set
    income = excluded.income,
    expenses = excluded.expenses,
    emergency_savings = excluded.emergency_savings,
    free_savings = excluded.free_savings,
    planned_debt = case when v_frozen then excluded.planned_debt else a.planned_debt end,
    planned_savings = case when v_frozen then excluded.planned_savings else a.planned_savings end,
    planned_income = case when v_frozen then excluded.planned_income else a.planned_income end,
    planned_expenses = case when v_frozen then excluded.planned_expenses else a.planned_expenses end,
    plan_start_month = case when v_frozen then excluded.plan_start_month else a.plan_start_month end
  returning a.id into v_id;

  delete from public.monthly_actual_loan_balances where monthly_actual_id = v_id;
  insert into public.monthly_actual_loan_balances (monthly_actual_id, loan_id, balance)
  select v_id, (b ->> 'loan_id')::uuid, (b ->> 'balance')::public.money
  from jsonb_array_elements(p_loan_balances) b;

  delete from public.monthly_actual_goal_balances where monthly_actual_id = v_id;
  insert into public.monthly_actual_goal_balances (monthly_actual_id, goal_id, balance)
  select v_id, (b ->> 'goal_id')::uuid, (b ->> 'balance')::public.money
  from jsonb_array_elements(p_goal_balances) b;

  delete from public.monthly_actual_lines where monthly_actual_id = v_id;
  insert into public.monthly_actual_lines (
    monthly_actual_id, kind, direction, category, budget_line_id, exception_id, label, planned, actual, position
  )
  select v_id, r.kind, r.direction, r.category, r.budget_line_id, r.exception_id, r.label, r.planned, r.actual, r.position
  from jsonb_populate_recordset(null::public.monthly_actual_lines, p_lines) r;

  delete from public.monthly_actual_deposits where monthly_actual_id = v_id;
  insert into public.monthly_actual_deposits (monthly_actual_id, pot, goal_id, goal_name, planned, amount, position)
  select v_id, r.pot, r.goal_id, r.goal_name, r.planned, r.amount, r.position
  from jsonb_populate_recordset(null::public.monthly_actual_deposits, p_deposits) r;

  if jsonb_typeof(p_statements) = 'array' then
    delete from public.bank_statements where monthly_actual_id = v_id;
    insert into public.bank_statements (
      monthly_actual_id, account_id, account_name, file_name, fingerprint, transaction_count, total_in, total_out, line_totals, position
    )
    select v_id, r.account_id, r.account_name, r.file_name, r.fingerprint, r.transaction_count, r.total_in, r.total_out, r.line_totals, r.position
    from jsonb_populate_recordset(null::public.bank_statements, p_statements) r;
  end if;

  return v_id;
end;
$$;

-- 2. The columns (their check constraints go with them).
alter table public.monthly_actuals drop column moving_savings;
alter table public.budget_settings
  drop column moving_name,
  drop column moving_goal,
  drop column moving_deadline_month,
  drop column moving_already_saved,
  drop column moving_priority;
