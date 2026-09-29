-- Check of 20260930090000_unify_goals (tech-debt 6) and its rollback on the LOCAL database, which
-- must be at the migration just before it. Everything runs in one transaction that is rolled back.
-- Run: scripts/test-goal-migration.sh
\set ON_ERROR_STOP on
begin;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end;
$$;

-- ---------------------------------------------------------------------------- fixtures (fake data)
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@migration.test'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@migration.test'),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@migration.test');

-- A: named moving fund at priority 2, two extra goals (one sharing priority 2), two check-ins.
insert into public.budget_settings (user_id, start_month, moving_name, moving_goal, moving_deadline_month, moving_already_saved, moving_priority)
values ('00000000-0000-4000-8000-00000000000a', '2027-01', 'Voyage', 5000.00, '2027-12', 100.00, 2);
insert into public.savings_goals (id, user_id, name, target, deadline_month, priority)
values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000a', 'Voiture', 3000.00, '2028-06', 1),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a', 'Mariage', 8000.00, '2029-06', 2);
insert into public.monthly_actuals (id, user_id, month, moving_savings, emergency_savings, free_savings)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000a', '2027-01', 150.00, 0, 0),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000a', '2027-02', 200.00, 0, 0);
insert into public.monthly_actual_goal_balances (user_id, monthly_actual_id, goal_id, balance)
values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 50.00);

-- B: default moving fund (0 €), no extra goal. C: an extra goal without settings.
insert into public.budget_settings (user_id, start_month, moving_deadline_month)
values ('00000000-0000-4000-8000-00000000000b', '2027-01', '2027-01');
insert into public.monthly_actuals (user_id, month, moving_savings, emergency_savings, free_savings)
values ('00000000-0000-4000-8000-00000000000b', '2027-01', 0, 0, 0);
insert into public.savings_goals (user_id, name, target, deadline_month, priority)
values ('00000000-0000-4000-8000-00000000000c', 'Seul', 1000.00, '2028-01', 1);

-- ---------------------------------------------------------------------------- migrate
\ir ../migrations/20260930090000_unify_goals.sql
set constraints all immediate;

select pg_temp.check(
  (select array_agg(name || ':' || priority || ':' || is_primary order by priority) from public.savings_goals
   where user_id = '00000000-0000-4000-8000-00000000000a')
  = array['Voiture:1:false', 'Voyage:2:true', 'Mariage:3:false'],
  'A: primary goal added between its neighbours, priorities 1..3');
select pg_temp.check(
  (select (target, deadline_month::text, already_saved) = (5000.00::numeric, '2027-12', 100.00::numeric)
   from public.savings_goals where user_id = '00000000-0000-4000-8000-00000000000a' and is_primary),
  'A: primary goal amounts copied');
select pg_temp.check(
  (select array_agg(b.balance::numeric order by a.month) from public.monthly_actual_goal_balances b
   join public.monthly_actuals a on a.id = b.monthly_actual_id
   join public.savings_goals g on g.id = b.goal_id and g.is_primary
   where a.user_id = '00000000-0000-4000-8000-00000000000a') = array[150.00, 200.00]::numeric[],
  'A: check-in balances moved to the primary goal');
select pg_temp.check(
  (select count(*) = 1 and bool_and(is_primary and target = 0) from public.savings_goals
   where user_id = '00000000-0000-4000-8000-00000000000b'),
  'B: primary goal at 0 € created');
select pg_temp.check(
  (select bool_and(is_primary) from public.savings_goals where user_id = '00000000-0000-4000-8000-00000000000c'),
  'C: lone goal promoted to primary');

-- A second primary goal is refused; a goal without target is refused unless primary.
do $$ begin
  begin
    update public.savings_goals set is_primary = true where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FAILED: second primary accepted';
  exception when unique_violation then raise notice 'ok: second primary refused';
  end;
  begin
    update public.savings_goals set target = 0 where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FAILED: extra goal at 0 € accepted';
  exception when check_violation then raise notice 'ok: extra goal needs a target';
  end;
end $$;

-- A write after the migration survives the rollback.
update public.savings_goals set target = 6000.00 where user_id = '00000000-0000-4000-8000-00000000000a' and is_primary;
update public.monthly_actual_goal_balances b set balance = 210.00
from public.savings_goals g
where g.id = b.goal_id and g.is_primary and b.monthly_actual_id = '00000000-0000-4000-8000-0000000000f2';

-- ---------------------------------------------------------------------------- rollback
\ir ../rollbacks/20260930090000_unify_goals.down.sql
set constraints all immediate;

select pg_temp.check(
  (select (moving_name, moving_goal, moving_deadline_month::text, moving_already_saved, moving_priority)
          = ('Voyage', 6000.00::numeric, '2027-12', 100.00::numeric, 2::smallint)
   from public.budget_settings where user_id = '00000000-0000-4000-8000-00000000000a'),
  'rollback: moving fund back in the settings, with the later edit');
select pg_temp.check(
  (select array_agg(moving_savings::numeric order by month) from public.monthly_actuals
   where user_id = '00000000-0000-4000-8000-00000000000a') = array[150.00, 210.00]::numeric[],
  'rollback: check-in balances back in moving_savings, with the later edit');
select pg_temp.check(
  (select array_agg(name || ':' || priority order by priority) from public.savings_goals
   where user_id = '00000000-0000-4000-8000-00000000000a') = array['Voiture:1', 'Mariage:3'],
  'rollback: extra goals only, around the moving fund''s priority');
select pg_temp.check(
  not exists (select 1 from information_schema.columns where table_name = 'savings_goals' and column_name = 'is_primary'),
  'rollback: is_primary column gone');

-- ---------------------------------------------------------------------------- migrate again
\ir ../migrations/20260930090000_unify_goals.sql
set constraints all immediate;
select pg_temp.check(
  (select array_agg(name || ':' || priority || ':' || is_primary order by priority) from public.savings_goals
   where user_id = '00000000-0000-4000-8000-00000000000a')
  = array['Voiture:1:false', 'Voyage:2:true', 'Mariage:3:false'],
  're-migrate: same goals as the first time');

rollback;
\echo 'All migration checks passed (nothing was kept).'
