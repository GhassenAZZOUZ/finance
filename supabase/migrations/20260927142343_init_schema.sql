-- Finance plan V1 schema (docs/SPEC.md).
-- Every row carries user_id; RLS restricts every table to user_id = auth.uid().
-- Money: numeric(12,2) euros (the app converts to integer cents). Months: 'YYYY-MM' text.
-- No bank account numbers, IBANs or credentials are ever stored: balances and amounts only.

create domain public.year_month as text
  check (value ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

create domain public.money as numeric(12, 2)
  check (value >= 0);

create domain public.rate as numeric(7, 6)
  check (value >= 0 and value <= 1);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------- profiles
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------- budget settings
create table public.budget_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  start_month public.year_month not null,
  moving_goal public.money not null default 0,
  moving_deadline_month public.year_month not null,
  moving_already_saved public.money not null default 0,
  emergency_target public.money not null default 0,
  emergency_existing public.money not null default 0,
  risk_free_rate public.rate not null default 0,
  early_repayment_pct public.rate not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------- budget lines
create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (category in ('income', 'fixed', 'variable')),
  label text not null check (char_length(btrim(label)) between 1 and 100),
  amount public.money not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budget_lines_user_idx on public.budget_lines (user_id, category, position);

-- ---------------------------------------------------------------------------- loans
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 100),
  type text check (char_length(type) <= 100),
  principal numeric(12, 2) not null check (principal > 0),
  apr public.rate not null,
  monthly_payment numeric(12, 2) not null check (monthly_payment > 0),
  position integer not null default 0,
  -- Loans with check-in history are archived instead of deleted (SPEC D8).
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index loans_user_idx on public.loans (user_id, position) where archived_at is null;

-- At most 6 active loans per user (SPEC D7).
create or replace function public.enforce_active_loan_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is null and (
    select count(*) from public.loans
    where user_id = new.user_id and archived_at is null and id <> new.id
  ) >= 6 then
    raise exception 'Maximum 6 active loans per user' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------- monthly actuals
create table public.monthly_actuals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month public.year_month not null,
  -- Information only (SPEC §8.1).
  income public.money,
  expenses public.money,
  moving_savings public.money not null,
  emergency_savings public.money not null,
  free_savings public.money not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month),
  unique (id, user_id)
);

create table public.monthly_actual_loan_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  monthly_actual_id uuid not null,
  loan_id uuid not null,
  balance public.money not null,
  created_at timestamptz not null default now(),
  unique (monthly_actual_id, loan_id),
  -- Composite keys: a balance can only point at the same user's check-in and loan.
  foreign key (monthly_actual_id, user_id) references public.monthly_actuals (id, user_id) on delete cascade,
  foreign key (loan_id, user_id) references public.loans (id, user_id) on delete restrict
);
create index monthly_actual_loan_balances_loan_idx on public.monthly_actual_loan_balances (loan_id);

-- ---------------------------------------------------------------------------- triggers
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger budget_settings_updated_at before update on public.budget_settings
  for each row execute function public.set_updated_at();
create trigger budget_lines_updated_at before update on public.budget_lines
  for each row execute function public.set_updated_at();
create trigger loans_updated_at before update on public.loans
  for each row execute function public.set_updated_at();
create trigger monthly_actuals_updated_at before update on public.monthly_actuals
  for each row execute function public.set_updated_at();
create trigger loans_active_limit before insert or update of archived_at, user_id on public.loans
  for each row execute function public.enforce_active_loan_limit();

-- New user: profile + the spreadsheet's budget lines at 0 € (SPEC D9).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.budget_lines (user_id, category, label, position)
  values
    (new.id, 'income', 'Salaire net (après impôt à la source)', 0),
    (new.id, 'income', 'Primes / 13e mois (lissés par mois)', 1),
    (new.id, 'income', 'Autres revenus', 2),
    (new.id, 'fixed', 'Loyer', 0),
    (new.id, 'fixed', 'Charges / énergie', 1),
    (new.id, 'fixed', 'Assurances (habitation, santé...)', 2),
    (new.id, 'fixed', 'Internet / mobile', 3),
    (new.id, 'fixed', 'Transport (Navigo, carburant...)', 4),
    (new.id, 'fixed', 'Abonnements (streaming, sport...)', 5),
    (new.id, 'fixed', 'Impôts / taxes mensualisés', 6),
    (new.id, 'fixed', 'Autres charges fixes', 7),
    (new.id, 'variable', 'Courses', 0),
    (new.id, 'variable', 'Loisirs / sorties / restaurants', 1),
    (new.id, 'variable', 'Shopping', 2),
    (new.id, 'variable', 'Divers', 3);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------- row level security
alter table public.profiles enable row level security;
alter table public.budget_settings enable row level security;
alter table public.budget_lines enable row level security;
alter table public.loans enable row level security;
alter table public.monthly_actuals enable row level security;
alter table public.monthly_actual_loan_balances enable row level security;

-- Signed-in users only; anonymous visitors get no table access at all.
revoke all on public.profiles, public.budget_settings, public.budget_lines, public.loans,
  public.monthly_actuals, public.monthly_actual_loan_balances from anon;

-- One "own rows only" policy per table and command.
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'budget_settings', 'budget_lines', 'loans',
                           'monthly_actuals', 'monthly_actual_loan_balances']
  loop
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated
                      using (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated
                      with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated
                      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated
                      using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Profiles are created by the signup trigger only.
revoke insert on public.profiles from authenticated;
