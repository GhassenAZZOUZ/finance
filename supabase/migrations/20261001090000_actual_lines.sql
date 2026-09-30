-- Issue #72: the check-in records the actual amount of each budget line of the month (plus its
-- one-off exceptions and two « hors budget » rows). Each row keeps a copy of the label, category and
-- planned amount, so a later budget change never rewrites a past month (like D16's frozen values).
-- The month's income / expenses become the sums of the rows (the app sends them with the check-in).
-- Replaces bank_line_totals (#63, empty on hosted): the bank CSV now pre-fills these rows.
-- Revert: drop function public.save_actual(jsonb, jsonb, jsonb, jsonb); drop table public.monthly_actual_lines;
--         then re-run 20260929110000_atomic_save_actual.sql and 20260930190000_bank_rules.sql.

-- A row may point at the same user's exception only.
alter table public.budget_exceptions add constraint budget_exceptions_id_user_id_key unique (id, user_id);

create table public.monthly_actual_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  monthly_actual_id uuid not null,
  -- 'line' = a budget line, 'exception' = a one-off exception (D14), 'other' = « hors budget ».
  kind text not null check (kind in ('line', 'exception', 'other')),
  direction text not null check (direction in ('income', 'expense')),
  -- The budget line's category at save time ('income', 'fixed', 'variable'); null for the others.
  category text check (category in ('income', 'fixed', 'variable')),
  -- Where the row came from; null once that line or exception is deleted (the copy stays).
  budget_line_id uuid,
  exception_id uuid,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  planned public.money not null,
  actual public.money not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  check ((kind = 'line') = (category is not null)),
  foreign key (monthly_actual_id, user_id) references public.monthly_actuals (id, user_id) on delete cascade,
  foreign key (budget_line_id, user_id) references public.budget_lines (id, user_id) on delete set null (budget_line_id),
  foreign key (exception_id, user_id) references public.budget_exceptions (id, user_id) on delete set null (exception_id)
);
create index monthly_actual_lines_actual_idx on public.monthly_actual_lines (monthly_actual_id);
create index monthly_actual_lines_line_idx on public.monthly_actual_lines (budget_line_id);
create index monthly_actual_lines_exception_idx on public.monthly_actual_lines (exception_id);

alter table public.monthly_actual_lines enable row level security;
revoke all on public.monthly_actual_lines from anon;
grant select, insert, update, delete on public.monthly_actual_lines to authenticated;
grant all on public.monthly_actual_lines to service_role;
revoke truncate, references, trigger on public.monthly_actual_lines from authenticated;

create policy "monthly_actual_lines_select_own" on public.monthly_actual_lines for select to authenticated
  using (user_id = (select auth.uid()));
create policy "monthly_actual_lines_insert_own" on public.monthly_actual_lines for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "monthly_actual_lines_update_own" on public.monthly_actual_lines for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "monthly_actual_lines_delete_own" on public.monthly_actual_lines for delete to authenticated
  using (user_id = (select auth.uid()));

-- save_actual gains the rows: the month, its balances and its rows, or nothing.
drop function public.save_actual(jsonb, jsonb, jsonb);

create function public.save_actual(p_actual jsonb, p_loan_balances jsonb, p_goal_balances jsonb, p_lines jsonb)
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
     or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'save_actual: invalid payload' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_loan_balances || p_goal_balances || p_lines) b where jsonb_typeof(b) <> 'object'
  ) then
    raise exception 'save_actual: invalid row' using errcode = '22023';
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

  delete from public.monthly_actual_lines where monthly_actual_id = v_id;
  insert into public.monthly_actual_lines (
    monthly_actual_id, kind, direction, category, budget_line_id, exception_id, label, planned, actual, position
  )
  select v_id, r.kind, r.direction, r.category, r.budget_line_id, r.exception_id, r.label, r.planned, r.actual, r.position
  from jsonb_populate_recordset(null::public.monthly_actual_lines, p_lines) r;

  return v_id;
end;
$$;

revoke execute on function public.save_actual(jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_actual(jsonb, jsonb, jsonb, jsonb) to authenticated;

-- The bank import keeps its keyword rules only; its per-line totals are now check-in rows.
drop function public.save_bank_import(public.year_month, jsonb, jsonb);
drop table public.bank_line_totals;

create function public.save_bank_rules(p_rules jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_rules) is distinct from 'array' then
    raise exception 'save_bank_rules: invalid payload' using errcode = '22023';
  end if;
  insert into public.bank_csv_rules as b (keyword, budget_line_id)
  select r.keyword, r.budget_line_id
  from jsonb_populate_recordset(null::public.bank_csv_rules, p_rules) r
  on conflict (user_id, keyword) do update set budget_line_id = excluded.budget_line_id;
end;
$$;

revoke execute on function public.save_bank_rules(jsonb) from public, anon;
grant execute on function public.save_bank_rules(jsonb) to authenticated;
