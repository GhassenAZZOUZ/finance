-- Tech-debt 2.1: a monthly check-in is saved all-or-nothing. The month, its loan balances and its
-- goal balances were three separate API requests; a failure half-way left a month without balances.
-- Runs as the caller (security invoker), so RLS still restricts every row to auth.uid().
-- Amounts arrive in euros, converted by the repository exactly as for the other tables.
-- Revert: drop function public.save_actual(jsonb, jsonb, jsonb);

create function public.save_actual(p_actual jsonb, p_loan_balances jsonb, p_goal_balances jsonb)
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
     or jsonb_typeof(p_goal_balances) is distinct from 'array' then
    raise exception 'save_actual: invalid payload' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_loan_balances || p_goal_balances) b where jsonb_typeof(b) <> 'object') then
    raise exception 'save_actual: invalid balance' using errcode = '22023';
  end if;

  insert into public.monthly_actuals as a (
    month, income, expenses, moving_savings, emergency_savings, free_savings,
    planned_debt, planned_savings, planned_income, planned_expenses, plan_start_month
  )
  values (
    (p_actual ->> 'month')::public.year_month,
    (p_actual ->> 'income')::public.money,
    (p_actual ->> 'expenses')::public.money,
    (p_actual ->> 'moving_savings')::public.money,
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
    moving_savings = excluded.moving_savings,
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

  return v_id;
end;
$$;

-- Signed-in users only (hosted projects grant execute to anon by default).
revoke execute on function public.save_actual(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_actual(jsonb, jsonb, jsonb) to authenticated;
