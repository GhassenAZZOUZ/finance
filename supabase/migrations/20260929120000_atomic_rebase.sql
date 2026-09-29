-- Tech-debt 2.2: « Recaler le plan » (SPEC D16) is applied all-or-nothing. It was up to one request
-- per frozen month, then the settings, then one per loan and per goal; a failure half-way left the
-- plan re-based with only part of its balances. Both functions run as the caller (security invoker),
-- so RLS still restricts every row to auth.uid(). Rows arrive in the tables' column names, amounts in
-- euros, converted by the repository exactly as for the other writes.
-- Revert: drop function public.rebase_plan(jsonb, jsonb, jsonb, jsonb, jsonb);
--         drop function public.freeze_actuals(jsonb);

-- Freezes planned values on the given check-ins that have none yet, in one statement.
create function public.freeze_actuals(p_freezes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_freezes) is distinct from 'array' then
    raise exception 'freeze_actuals: invalid payload' using errcode = '22023';
  end if;
  update public.monthly_actuals a
  set planned_debt = f.planned_debt,
      planned_savings = f.planned_savings,
      planned_income = f.planned_income,
      planned_expenses = f.planned_expenses,
      plan_start_month = f.plan_start_month
  from jsonb_populate_recordset(null::public.monthly_actuals, p_freezes) f
  where a.month = f.month and a.planned_debt is null;
end;
$$;

create function public.rebase_plan(
  p_settings jsonb,
  p_freezes jsonb,
  p_loan_updates jsonb,
  p_loans_to_archive jsonb,
  p_goal_updates jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_id uuid;
begin
  if jsonb_typeof(p_settings) is distinct from 'object'
     or jsonb_typeof(p_loan_updates) is distinct from 'array'
     or jsonb_typeof(p_loans_to_archive) is distinct from 'array'
     or jsonb_typeof(p_goal_updates) is distinct from 'array' then
    raise exception 'rebase_plan: invalid payload' using errcode = '22023';
  end if;

  -- 1. History first: check-ins keep the plan they were compared with.
  perform public.freeze_actuals(p_freezes);

  -- 2. The new start and starting balances.
  update public.budget_settings s
  set start_month = r.start_month,
      moving_goal = r.moving_goal,
      moving_deadline_month = r.moving_deadline_month,
      moving_already_saved = r.moving_already_saved,
      emergency_target = r.emergency_target,
      emergency_existing = r.emergency_existing,
      free_savings_existing = r.free_savings_existing,
      risk_free_rate = r.risk_free_rate,
      early_repayment_pct = r.early_repayment_pct
  from jsonb_populate_record(null::public.budget_settings, p_settings) r
  where s.user_id = (select auth.uid());
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'rebase_plan: settings not found' using errcode = 'P0002';
  end if;

  -- 3. Loans: remaining principal read at the check-in.
  update public.loans l
  set name = r.name,
      type = r.type,
      principal = r.principal,
      principal_paid_through_month = r.principal_paid_through_month,
      apr = r.apr,
      monthly_payment = r.monthly_payment,
      contract_end_month = r.contract_end_month,
      penalty_pct = r.penalty_pct,
      penalty_cap_months = r.penalty_cap_months,
      kind = r.kind,
      credit_limit = r.credit_limit
  from jsonb_populate_recordset(null::public.loans, p_loan_updates) r
  where l.id = r.id;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_loan_updates) then
    raise exception 'rebase_plan: loan not found' using errcode = 'P0002';
  end if;

  -- 4. Repaid loans: archived when check-ins reference them, deleted otherwise (SPEC D8).
  for v_id in select value::uuid from jsonb_array_elements_text(p_loans_to_archive) loop
    if exists (select 1 from public.monthly_actual_loan_balances b where b.loan_id = v_id) then
      update public.loans set archived_at = now() where id = v_id;
    else
      delete from public.loans where id = v_id;
    end if;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'rebase_plan: loan not found' using errcode = 'P0002';
    end if;
  end loop;

  -- 5. Extra goals: « already saved » becomes the check-in balance.
  update public.savings_goals g
  set name = r.name,
      target = r.target,
      deadline_month = r.deadline_month,
      already_saved = r.already_saved
  from jsonb_populate_recordset(null::public.savings_goals, p_goal_updates) r
  where g.id = r.id;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_goal_updates) then
    raise exception 'rebase_plan: goal not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Signed-in users only (hosted projects grant execute to anon by default).
revoke execute on function public.freeze_actuals(jsonb) from public, anon;
revoke execute on function public.rebase_plan(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.freeze_actuals(jsonb) to authenticated;
grant execute on function public.rebase_plan(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
