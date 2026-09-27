-- One-off budget exceptions (docs/SPEC.md D14): extra income or extra expenses for a single month,
-- on top of the regular monthly budget.

create table public.budget_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month public.year_month not null,
  kind text not null check (kind in ('income', 'expense')),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index budget_exceptions_user_month_idx on public.budget_exceptions (user_id, month);

alter table public.budget_exceptions enable row level security;
revoke all on public.budget_exceptions from anon;
grant select, insert, update, delete on public.budget_exceptions to authenticated;
grant all on public.budget_exceptions to service_role;

create policy "budget_exceptions_select_own" on public.budget_exceptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "budget_exceptions_insert_own" on public.budget_exceptions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "budget_exceptions_update_own" on public.budget_exceptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "budget_exceptions_delete_own" on public.budget_exceptions for delete to authenticated
  using (user_id = (select auth.uid()));
