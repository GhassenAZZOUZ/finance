-- Free plan limits enforced by the database (issue #139, US-2 of the monetization epic #150).
-- Owner decisions 2026-10-06/07: Free = 1 active loan and 1 savings goal (the history and the plan
-- horizon are limited in the interface only, since every check-in feeds the computed balances);
-- accounts that exist before the launch get Pro for free.
-- Revert: drop trigger loans_free_limit on public.loans; drop trigger savings_goals_free_limit on
--   public.savings_goals; drop function public.enforce_free_limits(); drop function public.has_pro(uuid);
--   then re-create entitlements from 20261006120000_subscriptions.sql (drop it first: one column less);
--   drop table public.pro_grants;
--   drop table public.plan_limits.

-- The limits, in one place, read by the triggers below and by the app (paywall wording).
create table public.plan_limits (
  key text primary key check (key ~ '^[a-z_]+_limit$'),
  free_value integer not null check (free_value >= 0)
);
insert into public.plan_limits (key, free_value) values ('loans_limit', 1), ('goals_limit', 1);

alter table public.plan_limits enable row level security;
revoke all on public.plan_limits from anon, authenticated;
grant select on public.plan_limits to authenticated;
grant all on public.plan_limits to service_role;
create policy "plan_limits_read" on public.plan_limits for select to authenticated using (true);

-- Pro given without Stripe (early users, gifts). Written by the service role only.
create table public.pro_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null check (reason in ('early_user', 'gift')),
  granted_at timestamptz not null default now(),
  -- Null = no end.
  expires_at timestamptz
);

alter table public.pro_grants enable row level security;
revoke all on public.pro_grants from anon, authenticated;
grant select on public.pro_grants to authenticated;
grant all on public.pro_grants to service_role;
create policy "pro_grants_select_own" on public.pro_grants for select to authenticated
  using (user_id = (select auth.uid()));

-- Every account that exists now is an early user (owner decision 2026-10-07).
insert into public.pro_grants (user_id, reason) select u.id, 'early_user' from auth.users u;

-- The rights now come from a Stripe subscription or a grant (SPEC D35). Same columns in the same
-- order, one added at the end: replaced in place.
create or replace view public.entitlements
with (security_invoker = true)
as
select
  coalesce(s.user_id, g.user_id) as user_id,
  coalesce(s.status, 'granted') as status,
  s.current_period_end,
  coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
  (s.user_id is not null and public.subscription_is_pro(s.status, s.past_due_since, now()))
    or (g.user_id is not null and (g.expires_at is null or g.expires_at > now())) as is_pro,
  g.reason as grant_reason
from public.subscriptions s
full join public.pro_grants g on g.user_id = s.user_id;

revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
grant select on public.entitlements to service_role;

-- Whether a user has Pro now; used by the limit triggers (runs as its owner: the trigger may act
-- for another role, e.g. an import or the service role). Not callable from the API.
create function public.has_pro(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user and public.subscription_is_pro(s.status, s.past_due_since, now())
  ) or exists (
    select 1 from public.pro_grants g
    where g.user_id = p_user and (g.expires_at is null or g.expires_at > now())
  )
$$;
revoke execute on function public.has_pro(uuid) from public, anon, authenticated;

-- Refuses a row beyond the Free limit with SQLSTATE PT402 (PostgREST answers HTTP 402) and the
-- limit key as message (`loans_limit`, `goals_limit`): the app shows the paywall (US-3).
create function public.enforce_free_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := tg_argv[0];
  v_limit integer;
  v_count integer;
begin
  -- Nested: PL/pgSQL may evaluate both sides of an AND, and savings_goals has no archived_at.
  if tg_table_name = 'loans' then
    if new.archived_at is not null then
      return new;
    end if;
  end if;
  if public.has_pro(new.user_id) then
    return new;
  end if;
  select l.free_value into v_limit from public.plan_limits l where l.key = v_key;
  if v_limit is null then
    return new;
  end if;
  if tg_table_name = 'loans' then
    select count(*) into v_count from public.loans t where t.user_id = new.user_id and t.archived_at is null and t.id <> new.id;
  else
    select count(*) into v_count from public.savings_goals t where t.user_id = new.user_id and t.id <> new.id;
  end if;
  if v_count >= v_limit then
    raise exception '%', v_key using errcode = 'PT402', detail = format('Free plan: %s maximum', v_limit);
  end if;
  return new;
end;
$$;

-- Loans: a new active loan, or an archived one made active again.
create trigger loans_free_limit before insert or update of archived_at on public.loans
  for each row execute function public.enforce_free_limits('loans_limit');
create trigger savings_goals_free_limit before insert on public.savings_goals
  for each row execute function public.enforce_free_limits('goals_limit');

revoke execute on function public.enforce_free_limits() from public, anon, authenticated;
