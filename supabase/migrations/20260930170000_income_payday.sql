-- Salary payment dates (issue #60, SPEC D29): each income line has a usual payday (a day, of the
-- previous month or of the month itself), and a month can record the actual date an income was
-- paid when it differs. The default (1 of the same month) keeps today's behaviour.

alter table public.budget_lines
  add column payday_day smallint not null default 1 check (payday_day between 1 and 31),
  add column payday_previous_month boolean not null default false,
  add constraint budget_lines_id_user_id_key unique (id, user_id);

create table public.income_payments (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The month whose budget the income funds (it may be paid in the month before).
  month public.year_month not null,
  budget_line_id uuid not null,
  paid_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, month, budget_line_id),
  -- Deleting an income line deletes its dates.
  foreign key (budget_line_id, user_id) references public.budget_lines (id, user_id) on delete cascade,
  -- From the 1st of the month before to the last day of the month (SPEC D29).
  check (paid_on >= (month || '-01')::date - interval '1 month' and paid_on < (month || '-01')::date + interval '1 month')
);
create index income_payments_line_idx on public.income_payments (budget_line_id, user_id);

create trigger income_payments_set_updated_at before update on public.income_payments
  for each row execute function public.set_updated_at();

alter table public.income_payments enable row level security;
revoke all on public.income_payments from anon;
grant select, insert, update, delete on public.income_payments to authenticated;
grant all on public.income_payments to service_role;
revoke truncate, references, trigger on public.income_payments from authenticated;

create policy "income_payments_select_own" on public.income_payments for select to authenticated
  using (user_id = (select auth.uid()));
create policy "income_payments_insert_own" on public.income_payments for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "income_payments_update_own" on public.income_payments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "income_payments_delete_own" on public.income_payments for delete to authenticated
  using (user_id = (select auth.uid()));

-- save_budget (also used by apply_import): same steps, plus each line's payday.
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

  insert into public.budget_lines as l (
    id, category, label, amount, position, start_month, end_month, indexed, payday_day, payday_previous_month
  )
  select r.id, r.category, r.label, r.amount, r.position, r.start_month, r.end_month, coalesce(r.indexed, true),
         coalesce(r.payday_day, 1), coalesce(r.payday_previous_month, false)
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is not null
  on conflict (id) do update set
    category = excluded.category,
    label = excluded.label,
    amount = excluded.amount,
    position = excluded.position,
    start_month = excluded.start_month,
    end_month = excluded.end_month,
    indexed = excluded.indexed,
    payday_day = excluded.payday_day,
    payday_previous_month = excluded.payday_previous_month;

  insert into public.budget_lines (category, label, amount, position, start_month, end_month, indexed, payday_day, payday_previous_month)
  select r.category, r.label, r.amount, r.position, r.start_month, r.end_month, coalesce(r.indexed, true),
         coalesce(r.payday_day, 1), coalesce(r.payday_previous_month, false)
  from jsonb_populate_recordset(null::public.budget_lines, p_lines) r
  where r.id is null;
end;
$$;
