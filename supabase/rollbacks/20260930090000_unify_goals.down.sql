-- Rollback of 20260930090000_unify_goals.sql (tech-debt 6), to run by hand in one transaction:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollbacks/20260930090000_unify_goals.down.sql
-- then deploy the app version before the migration and delete the migration from the history
-- (supabase migration repair --status reverted 20260930090000).
-- Writes made after the migration are kept: the primary goal and its check-in balances are copied
-- back into budget_settings.moving_* and monthly_actuals.moving_savings before being removed.
-- Not a migration: it lives outside supabase/migrations so it never runs on its own.

-- The primary goal back into the settings (a user whose primary goal was deleted gets 0 and the plan start).
update public.budget_settings s
set moving_name = g.name,
    moving_goal = g.target,
    moving_deadline_month = g.deadline_month,
    moving_already_saved = g.already_saved,
    moving_priority = g.priority
from public.savings_goals g
where g.user_id = s.user_id and g.is_primary;

update public.budget_settings s
set moving_goal = 0, moving_already_saved = 0, moving_deadline_month = s.start_month
where s.moving_deadline_month is null;

update public.monthly_actuals a
set moving_savings = coalesce(
  (select b.balance
   from public.monthly_actual_goal_balances b
   join public.savings_goals g on g.id = b.goal_id and g.is_primary
   where b.monthly_actual_id = a.id),
  a.moving_savings,
  0
);

-- The old app only knows extra goals: the primary rows and their balances go (the balances cascade).
drop trigger savings_goals_keep_primary on public.savings_goals;
drop trigger savings_goals_first_is_primary on public.savings_goals;
delete from public.savings_goals where is_primary;

-- Extra goals' priorities around the primary one (moving_priority = p): ranks below p stay, the
-- others move up one, so no extra goal shares the moving fund's priority.
with ranked as (
  select g.id, g.user_id, row_number() over (partition by g.user_id order by g.priority, g.id) as r
  from public.savings_goals g
)
update public.savings_goals g
set priority = ranked.r + case when ranked.r >= coalesce(s.moving_priority, 1) then 1 else 0 end
from ranked
left join public.budget_settings s on s.user_id = ranked.user_id
where g.id = ranked.id;

alter table public.monthly_actuals alter column moving_savings set not null;
alter table public.budget_settings alter column moving_deadline_month set not null;

drop index public.savings_goals_one_primary;
alter table public.savings_goals drop constraint savings_goals_target_check;
alter table public.savings_goals add constraint savings_goals_target_check check (target > 0);
alter table public.savings_goals drop column is_primary;

drop function public.delete_goal(uuid, uuid);
drop function public.savings_goals_keep_primary();
drop function public.savings_goals_first_is_primary();

-- Functions as before the migration: dropped, then re-created from their original migrations.
drop function public.apply_import(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);
drop function public.save_budget(jsonb, jsonb);
drop function public.rebase_plan(jsonb, jsonb, jsonb, jsonb, jsonb);
drop function public.freeze_actuals(jsonb);
\ir ../migrations/20260929120000_atomic_rebase.sql
\ir ../migrations/20260929130000_atomic_import.sql
