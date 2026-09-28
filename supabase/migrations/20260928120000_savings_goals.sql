-- Several savings goals (docs/SPEC.md D23, issue #10).
-- The moving fund stays in budget_settings as the PRIMARY goal (kept, not deletable) and gains a
-- name and a priority; extra goals live in savings_goals; check-ins get one balance per extra goal
-- (the primary goal's balance stays in monthly_actuals.moving_savings). No existing data moves, so
-- results are unchanged for existing users.
-- Revert: drop table public.monthly_actual_goal_balances, public.savings_goals;
--         alter table public.budget_settings drop column moving_name, drop column moving_priority;

alter table public.budget_settings
  add column moving_name text not null default 'Déménagement'
    check (char_length(btrim(moving_name)) between 1 and 100),
  add column moving_priority smallint not null default 1 check (moving_priority between 1 and 6);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  target public.money not null check (target > 0),
  deadline_month public.year_month not null,
  already_saved public.money not null default 0,
  -- 1 = filled first. Unique with the primary goal's moving_priority: checked by the app.
  priority smallint not null check (priority between 1 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- Deferred so that a reorder can swap priorities in one statement.
  unique (user_id, priority) deferrable initially deferred
);

create table public.monthly_actual_goal_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  monthly_actual_id uuid not null,
  goal_id uuid not null,
  balance public.money not null,
  created_at timestamptz not null default now(),
  unique (monthly_actual_id, goal_id),
  -- Composite keys: a balance can only point at the same user's check-in and goal.
  foreign key (monthly_actual_id, user_id) references public.monthly_actuals (id, user_id) on delete cascade,
  -- Deleting a goal drops its balances; past comparisons use the values frozen at save time (D16).
  foreign key (goal_id, user_id) references public.savings_goals (id, user_id) on delete cascade
);
create index monthly_actual_goal_balances_goal_idx on public.monthly_actual_goal_balances (goal_id);

create trigger savings_goals_set_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

alter table public.savings_goals enable row level security;
alter table public.monthly_actual_goal_balances enable row level security;

revoke all on public.savings_goals, public.monthly_actual_goal_balances from anon;
grant select, insert, update, delete on public.savings_goals, public.monthly_actual_goal_balances to authenticated;
grant all on public.savings_goals, public.monthly_actual_goal_balances to service_role;
revoke truncate, references, trigger on public.savings_goals, public.monthly_actual_goal_balances from authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['savings_goals', 'monthly_actual_goal_balances'] loop
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
