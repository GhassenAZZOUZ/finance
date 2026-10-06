-- Several bank statements per month (issue #115, SPEC D30/D31): the user's named bank accounts, each
-- with its own CSV column mapping, and each imported statement's summary saved with the check-in it
-- was added to. Still no transaction stored: per statement only its account, file name, a fingerprint
-- of its transactions (duplicates), their count, total in / out and the total per budget line.
-- Revert: drop function public.save_actual(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb); drop table
--         public.bank_statements; drop table public.bank_accounts; then re-run
--         20261001100000_savings_deposits.sql's save_actual.

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- How to read this account's CSV (null: Revolut, recognised from its header, or not mapped yet).
  mapping jsonb check (mapping is null or (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) < 8192)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create trigger bank_accounts_set_updated_at before update on public.bank_accounts
  for each row execute function public.set_updated_at();

create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  monthly_actual_id uuid not null,
  -- The account; null once it is deleted (the name copy stays, the check-in keeps its amounts).
  account_id uuid,
  account_name text not null check (char_length(btrim(account_name)) between 1 and 60),
  file_name text not null check (char_length(file_name) between 1 and 255),
  -- Hash of the month's transactions (date, label, amount): the same statement is not added twice.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16,64}$'),
  transaction_count integer not null check (transaction_count between 0 and 100000),
  total_in numeric(12, 2) not null check (total_in >= 0),
  total_out numeric(12, 2) not null check (total_out >= 0),
  -- [{ "budget_line_id": uuid, "actual": number }]: what the statement added to each row.
  line_totals jsonb not null check (jsonb_typeof(line_totals) = 'array' and pg_column_size(line_totals) < 16384),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (monthly_actual_id, user_id) references public.monthly_actuals (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.bank_accounts (id, user_id) on delete set null (account_id)
);
create index bank_statements_actual_idx on public.bank_statements (monthly_actual_id);
create index bank_statements_account_idx on public.bank_statements (account_id);

alter table public.bank_accounts enable row level security;
alter table public.bank_statements enable row level security;
revoke all on public.bank_accounts, public.bank_statements from anon;
grant select, insert, update, delete on public.bank_accounts, public.bank_statements to authenticated;
grant all on public.bank_accounts, public.bank_statements to service_role;
revoke truncate, references, trigger on public.bank_accounts, public.bank_statements from authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['bank_accounts', 'bank_statements'] loop
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated
      using (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated
      with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated
      using (user_id = (select auth.uid()))', t);
  end loop;
end
$$;

-- save_actual gains the month's statements: the month, its balances, rows, deposits and statements,
-- or nothing. The statements given replace the month's (a removed one is simply left out); JSON null
-- keeps the saved ones.
drop function public.save_actual(jsonb, jsonb, jsonb, jsonb, jsonb);

create function public.save_actual(
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

revoke execute on function public.save_actual(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_actual(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
