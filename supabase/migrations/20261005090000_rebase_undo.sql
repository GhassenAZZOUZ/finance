-- Issue #100: edit the proposed values before re-basing, and undo the latest re-base.
--
-- rebase_plan_with_undo() keeps a copy of everything the re-base changes (one row per user), calls the
-- existing rebase_plan(), and records the values corrected by hand on the check-in it starts from.
-- undo_rebase() puts everything back in one transaction. The copy expires (is deleted) as soon as a
-- check-in is saved or the budget, a loan or a goal is edited, so an undo never erases later work.
-- Additive only: rebase_plan() is unchanged and still callable.
-- Revert: drop function public.undo_rebase(); drop function public.rebase_plan_with_undo(jsonb, jsonb,
--   jsonb, jsonb, jsonb, public.year_month, jsonb); drop function public.expire_rebase_undo() cascade;
--   drop table public.plan_rebase_undo; alter table public.monthly_actuals drop column rebase_corrections;

-- Starting values corrected by hand in the re-base preview, on the check-in the re-base started from:
-- [{ "label": "Fonds d’urgence", "read": 300000, "used": 320000 }] (cents). Null = none.
alter table public.monthly_actuals add column rebase_corrections jsonb;

create table public.plan_rebase_undo (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  from_month public.year_month not null,
  new_start_month public.year_month not null,
  -- Rows as they were just before the re-base.
  settings jsonb not null,
  loans jsonb not null,
  goals jsonb not null,
  -- Months whose planned values the re-base froze (unfrozen by the undo).
  frozen_months jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.plan_rebase_undo enable row level security;
revoke all on public.plan_rebase_undo from anon;
-- Written only through rebase_plan_with_undo(); read to offer the undo; deleted by the expiry triggers.
grant select, insert, delete on public.plan_rebase_undo to authenticated;
grant all on public.plan_rebase_undo to service_role;

create policy "plan_rebase_undo_select_own" on public.plan_rebase_undo for select to authenticated
  using (user_id = (select auth.uid()));
create policy "plan_rebase_undo_insert_own" on public.plan_rebase_undo for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "plan_rebase_undo_delete_own" on public.plan_rebase_undo for delete to authenticated
  using (user_id = (select auth.uid()));

-- Expiry: any write to the plan's inputs or to a check-in drops the undo copy of the caller.
create function public.expire_rebase_undo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.plan_rebase_undo where user_id = (select auth.uid());
  return null;
end;
$$;

create trigger budget_settings_expire_rebase_undo after insert or update or delete on public.budget_settings
  for each statement execute function public.expire_rebase_undo();
create trigger budget_lines_expire_rebase_undo after insert or update or delete on public.budget_lines
  for each statement execute function public.expire_rebase_undo();
create trigger budget_exceptions_expire_rebase_undo after insert or update or delete on public.budget_exceptions
  for each statement execute function public.expire_rebase_undo();
create trigger loans_expire_rebase_undo after insert or update or delete on public.loans
  for each statement execute function public.expire_rebase_undo();
create trigger savings_goals_expire_rebase_undo after insert or update or delete on public.savings_goals
  for each statement execute function public.expire_rebase_undo();
create trigger monthly_actuals_expire_rebase_undo after insert or update or delete on public.monthly_actuals
  for each statement execute function public.expire_rebase_undo();

-- The re-base, keeping what it changes for an undo. Same payloads as rebase_plan(), plus the month
-- it starts from and the values corrected by hand (null or an array, see rebase_corrections).
create function public.rebase_plan_with_undo(
  p_settings jsonb,
  p_freezes jsonb,
  p_loan_updates jsonb,
  p_loans_to_archive jsonb,
  p_goal_updates jsonb,
  p_from_month public.year_month,
  p_corrections jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_loans jsonb;
  v_goals jsonb;
  v_frozen jsonb;
begin
  if p_corrections is not null and jsonb_typeof(p_corrections) is distinct from 'array' then
    raise exception 'rebase_plan_with_undo: invalid corrections' using errcode = '22023';
  end if;

  -- 1. What the re-base is about to change, as it is now.
  select to_jsonb(s) into v_settings from public.budget_settings s where s.user_id = (select auth.uid());
  if v_settings is null then
    raise exception 'rebase_plan_with_undo: settings not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_loans
  from public.loans l
  where l.id in (
    select (u ->> 'id')::uuid from jsonb_array_elements(p_loan_updates) u
    union
    select value::uuid from jsonb_array_elements_text(p_loans_to_archive)
  );
  select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_goals
  from public.savings_goals g
  where g.id in (select (u ->> 'id')::uuid from jsonb_array_elements(p_goal_updates) u);
  -- Only the check-ins not frozen yet are frozen by the re-base.
  select coalesce(jsonb_agg(a.month), '[]'::jsonb) into v_frozen
  from public.monthly_actuals a
  where a.planned_debt is null
    and a.month in (select f ->> 'month' from jsonb_array_elements(p_freezes) f);

  -- 2. The re-base itself (every write expires the previous undo copy).
  perform public.rebase_plan(p_settings, p_freezes, p_loan_updates, p_loans_to_archive, p_goal_updates);

  -- 3. Values corrected by hand, on the check-in the plan restarts from.
  update public.monthly_actuals
  set rebase_corrections = case when jsonb_array_length(coalesce(p_corrections, '[]'::jsonb)) = 0 then null else p_corrections end
  where month = p_from_month;

  -- 4. The undo copy, last: the writes above have already expired any older one.
  insert into public.plan_rebase_undo (from_month, new_start_month, settings, loans, goals, frozen_months)
  values (p_from_month, p_settings ->> 'start_month', v_settings, v_loans, v_goals, v_frozen);
end;
$$;

-- Puts back the plan as it was just before the latest re-base, in one transaction.
create function public.undo_rebase()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.plan_rebase_undo;
  v_loan jsonb;
begin
  select * into v from public.plan_rebase_undo where user_id = (select auth.uid());
  if not found then
    raise exception 'undo_rebase: nothing to undo' using errcode = 'P0002';
  end if;

  -- Settings: the columns rebase_plan() writes.
  update public.budget_settings s
  set start_month = r.start_month,
      emergency_target = r.emergency_target,
      emergency_existing = r.emergency_existing,
      free_savings_existing = r.free_savings_existing,
      risk_free_rate = r.risk_free_rate,
      early_repayment_pct = r.early_repayment_pct
  from jsonb_populate_record(null::public.budget_settings, v.settings) r
  where s.user_id = (select auth.uid());

  -- Loans: updated ones get their values back, archived ones are un-archived, deleted ones re-created.
  for v_loan in select value from jsonb_array_elements(v.loans) loop
    if exists (select 1 from public.loans where id = (v_loan ->> 'id')::uuid) then
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
          credit_limit = r.credit_limit,
          archived_at = r.archived_at
      from jsonb_populate_record(null::public.loans, v_loan) r
      where l.id = r.id;
    else
      insert into public.loans select * from jsonb_populate_record(null::public.loans, v_loan);
    end if;
  end loop;

  update public.savings_goals g
  set name = r.name,
      target = r.target,
      deadline_month = r.deadline_month,
      already_saved = r.already_saved
  from jsonb_populate_recordset(null::public.savings_goals, v.goals) r
  where g.id = r.id;

  -- Check-ins: unfreeze those the re-base froze, and drop the hand corrections.
  update public.monthly_actuals a
  set planned_debt = null,
      planned_savings = null,
      planned_income = null,
      planned_expenses = null,
      plan_start_month = null
  where a.month in (select value from jsonb_array_elements_text(v.frozen_months));
  update public.monthly_actuals set rebase_corrections = null where month = v.from_month;

  delete from public.plan_rebase_undo where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.rebase_plan_with_undo(jsonb, jsonb, jsonb, jsonb, jsonb, public.year_month, jsonb) from public, anon;
grant execute on function public.rebase_plan_with_undo(jsonb, jsonb, jsonb, jsonb, jsonb, public.year_month, jsonb) to authenticated;
revoke execute on function public.undo_rebase() from public, anon;
grant execute on function public.undo_rebase() to authenticated;
revoke execute on function public.expire_rebase_undo() from public, anon;
