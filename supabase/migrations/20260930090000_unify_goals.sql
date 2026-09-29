-- Tech-debt 6: the primary savings goal (the spreadsheet's moving fund, SPEC D23) becomes a row of
-- savings_goals flagged is_primary, like the other goals. Its check-in balance moves from
-- monthly_actuals.moving_savings to monthly_actual_goal_balances.
-- The old columns (budget_settings.moving_*, monthly_actuals.moving_savings) are kept, filled but no
-- longer written, until a later migration drops them: rollback in supabase/rollbacks/.
-- Invariant: a user with goals has exactly one primary goal.

-- ---------------------------------------------------------------------------- schema
alter table public.savings_goals add column is_primary boolean not null default false;
-- The primary goal may have no target yet (the moving fund defaulted to 0); the others need one.
alter table public.savings_goals drop constraint savings_goals_target_check;
alter table public.savings_goals add constraint savings_goals_target_check check (is_primary or target > 0);
create unique index savings_goals_one_primary on public.savings_goals (user_id) where is_primary;

-- No longer written by the app.
alter table public.budget_settings alter column moving_deadline_month drop not null;
alter table public.monthly_actuals alter column moving_savings drop not null;

-- ---------------------------------------------------------------------------- data
insert into public.savings_goals (user_id, name, target, deadline_month, already_saved, priority, is_primary)
select s.user_id, s.moving_name, s.moving_goal, s.moving_deadline_month, s.moving_already_saved, s.moving_priority, true
from public.budget_settings s
where not exists (select 1 from public.savings_goals g where g.user_id = s.user_id and g.is_primary);

-- Priorities 1..n per user in their current order (the primary first on a tie); the unique
-- (user_id, priority) constraint is deferred, so it is checked once all rows are renumbered.
update public.savings_goals g
set priority = r.n
from (
  select id, row_number() over (partition by user_id order by priority, is_primary desc, created_at, id) as n
  from public.savings_goals
) r
where g.id = r.id and g.priority <> r.n;

insert into public.monthly_actual_goal_balances (user_id, monthly_actual_id, goal_id, balance)
select a.user_id, a.id, g.id, a.moving_savings
from public.monthly_actuals a
join public.savings_goals g on g.user_id = a.user_id and g.is_primary
where a.moving_savings is not null
on conflict (monthly_actual_id, goal_id) do nothing;

-- Goals without settings (not expected): their first goal becomes the primary one.
update public.savings_goals g
set is_primary = true
where g.priority = 1
  and not exists (select 1 from public.savings_goals p where p.user_id = g.user_id and p.is_primary);

-- ---------------------------------------------------------------------------- primary goal rules
-- The first goal of a user becomes the primary one.
create function public.savings_goals_first_is_primary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.savings_goals g where g.user_id = new.user_id and g.is_primary) then
    new.is_primary := true;
  end if;
  return new;
end;
$$;

create trigger savings_goals_first_is_primary before insert on public.savings_goals
  for each row execute function public.savings_goals_first_is_primary();

-- At commit: goals without a primary one are refused (delete_goal hands the flag over first).
create function public.savings_goals_keep_primary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.savings_goals g where g.user_id = old.user_id)
     and not exists (select 1 from public.savings_goals g where g.user_id = old.user_id and g.is_primary) then
    raise exception 'savings goals need a primary goal' using errcode = 'P0003';
  end if;
  return null;
end;
$$;

create constraint trigger savings_goals_keep_primary after update of is_primary or delete on public.savings_goals
  deferrable initially deferred
  for each row execute function public.savings_goals_keep_primary();

revoke execute on function public.savings_goals_first_is_primary() from public, anon, authenticated;
revoke execute on function public.savings_goals_keep_primary() from public, anon, authenticated;

-- Deletes a goal and closes the priority gap. Deleting the primary goal while others remain needs
-- the goal that becomes primary (SPEC D23, owner decision 2026-09-29).
create function public.delete_goal(p_id uuid, p_new_primary uuid default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_primary boolean;
  v_count integer;
begin
  select g.is_primary into v_primary from public.savings_goals g where g.id = p_id;
  if not found then
    raise exception 'delete_goal: goal not found' using errcode = 'P0002';
  end if;

  if v_primary and exists (select 1 from public.savings_goals g where g.id <> p_id) then
    if p_new_primary is null or p_new_primary = p_id then
      raise exception 'delete_goal: choose the new primary goal' using errcode = '22023';
    end if;
    -- Unset first: at most one primary goal per user at any time (unique index).
    update public.savings_goals set is_primary = false where id = p_id;
    update public.savings_goals set is_primary = true where id = p_new_primary;
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'delete_goal: new primary goal not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.savings_goals where id = p_id;

  update public.savings_goals g
  set priority = r.n
  from (select id, row_number() over (order by priority, id) as n from public.savings_goals) r
  where g.id = r.id and g.priority <> r.n;
end;
$$;

revoke execute on function public.delete_goal(uuid, uuid) from public, anon;
grant execute on function public.delete_goal(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------- save functions
-- save_budget: the settings no longer carry the moving fund.
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
    start_month, emergency_target, emergency_existing, free_savings_existing, risk_free_rate, early_repayment_pct
  )
  select r.start_month, r.emergency_target, r.emergency_existing, r.free_savings_existing, r.risk_free_rate, r.early_repayment_pct
  from jsonb_populate_record(null::public.budget_settings, p_settings) r
  on conflict (user_id) do update set
    start_month = excluded.start_month,
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

-- rebase_plan: same steps; the primary goal is one of the goal updates, the settings keep only
-- the non-goal parameters.
create or replace function public.rebase_plan(
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

  perform public.freeze_actuals(p_freezes);

  update public.budget_settings s
  set start_month = r.start_month,
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

-- apply_import: the template's moving fund (target, deadline, already saved) goes to the primary
-- goal, created with the template's name when the user has no goal yet.
drop function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb);

create function public.apply_import(
  p_settings jsonb,
  p_lines jsonb,
  p_primary_goal jsonb,
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
  if jsonb_typeof(p_primary_goal) is distinct from 'object'
     or jsonb_typeof(p_loan_removals) is distinct from 'array'
     or jsonb_typeof(p_loan_updates) is distinct from 'array'
     or jsonb_typeof(p_loan_creates) is distinct from 'array' then
    raise exception 'apply_import: invalid payload' using errcode = '22023';
  end if;

  perform public.save_budget(p_settings, p_lines);

  update public.savings_goals g
  set target = r.target,
      deadline_month = r.deadline_month,
      already_saved = r.already_saved
  from jsonb_populate_record(null::public.savings_goals, p_primary_goal) r
  where g.is_primary;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    insert into public.savings_goals (name, target, deadline_month, already_saved, priority, is_primary)
    select r.name, r.target, r.deadline_month, r.already_saved, 1, true
    from jsonb_populate_record(null::public.savings_goals, p_primary_goal) r;
  end if;

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

revoke execute on function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
