-- Tech-debt 2.3: the Excel import (SPEC D20) is applied all-or-nothing. It was the budget (settings,
-- then line deletes / updates / inserts), then one request per loan removal, update and creation;
-- a failure half-way left a mix of the old and the imported plan. Both functions run as the caller
-- (security invoker), so RLS still restricts every row to auth.uid(). Rows arrive in the tables'
-- column names, amounts in euros, converted by the repository exactly as for the other writes.
-- Revert: drop function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb);
--         drop function public.save_budget(jsonb, jsonb);

-- Saves the parameters and replaces the budget lines (ids kept when given), like saveBudget.
create function public.save_budget(p_settings jsonb, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_settings) is distinct from 'object' or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'save_budget: invalid payload' using errcode = '22023';
  end if;

  -- The primary goal's name and priority are not part of the settings form: left as they are.
  insert into public.budget_settings as s (
    start_month, moving_goal, moving_deadline_month, moving_already_saved, emergency_target,
    emergency_existing, free_savings_existing, risk_free_rate, early_repayment_pct
  )
  select r.start_month, r.moving_goal, r.moving_deadline_month, r.moving_already_saved, r.emergency_target,
         r.emergency_existing, r.free_savings_existing, r.risk_free_rate, r.early_repayment_pct
  from jsonb_populate_record(null::public.budget_settings, p_settings) r
  on conflict (user_id) do update set
    start_month = excluded.start_month,
    moving_goal = excluded.moving_goal,
    moving_deadline_month = excluded.moving_deadline_month,
    moving_already_saved = excluded.moving_already_saved,
    emergency_target = excluded.emergency_target,
    emergency_existing = excluded.emergency_existing,
    free_savings_existing = excluded.free_savings_existing,
    risk_free_rate = excluded.risk_free_rate,
    early_repayment_pct = excluded.early_repayment_pct;

  delete from public.budget_lines l
  where l.id not in (
    select r.id from jsonb_populate_recordset(null::public.budget_lines, p_lines) r where r.id is not null
  );

  insert into public.budget_lines as l (id, category, label, amount, position, start_month, end_month)
  select r.id, r.category, r.label, r.amount, r.position, r.start_month, r.end_month
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is not null
  on conflict (id) do update set
    category = excluded.category,
    label = excluded.label,
    amount = excluded.amount,
    position = excluded.position,
    start_month = excluded.start_month,
    end_month = excluded.end_month;

  insert into public.budget_lines (category, label, amount, position, start_month, end_month)
  select r.category, r.label, r.amount, r.position, r.start_month, r.end_month
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is null;
end;
$$;

create function public.apply_import(
  p_settings jsonb,
  p_lines jsonb,
  p_loan_removals jsonb,
  p_loan_updates jsonb,
  p_loan_creates jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_id uuid;
  v_loan jsonb;
  v_position integer;
begin
  if jsonb_typeof(p_loan_removals) is distinct from 'array'
     or jsonb_typeof(p_loan_updates) is distinct from 'array'
     or jsonb_typeof(p_loan_creates) is distinct from 'array' then
    raise exception 'apply_import: invalid payload' using errcode = '22023';
  end if;

  perform public.save_budget(p_settings, p_lines);

  -- Removals first, so the 6-active-loan limit holds at every step. Archived when check-ins
  -- reference the loan, deleted otherwise (SPEC D8).
  for v_id in select value::uuid from jsonb_array_elements_text(p_loan_removals) loop
    if exists (select 1 from public.monthly_actual_loan_balances b where b.loan_id = v_id) then
      update public.loans set archived_at = now() where id = v_id;
    else
      delete from public.loans where id = v_id;
    end if;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'apply_import: loan not found' using errcode = 'P0002';
    end if;
  end loop;

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
    raise exception 'apply_import: loan not found' using errcode = 'P0002';
  end if;

  -- New loans go last, in file order (same positions as createLoan, one at a time).
  for v_loan in select e.value from jsonb_array_elements(p_loan_creates) with ordinality e order by e.ordinality loop
    select coalesce(max(position), -1) + 1 into v_position from public.loans;
    insert into public.loans (
      name, type, principal, principal_paid_through_month, apr, monthly_payment, contract_end_month,
      penalty_pct, penalty_cap_months, kind, credit_limit, position
    )
    select r.name, r.type, r.principal, r.principal_paid_through_month, r.apr, r.monthly_payment,
           r.contract_end_month, r.penalty_pct, r.penalty_cap_months, r.kind, r.credit_limit, v_position
    from jsonb_populate_record(null::public.loans, v_loan) r;
  end loop;
end;
$$;

-- Signed-in users only (hosted projects grant execute to anon by default).
revoke execute on function public.save_budget(jsonb, jsonb) from public, anon;
revoke execute on function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_budget(jsonb, jsonb) to authenticated;
grant execute on function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
