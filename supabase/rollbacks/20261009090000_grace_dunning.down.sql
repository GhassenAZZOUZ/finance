-- Rollback of 20261009090000_grace_dunning.sql (issue #144), to run by hand in one transaction:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollbacks/20261009090000_grace_dunning.down.sql
-- then delete the migration from the history (supabase migration repair --status reverted 20261009090000).
-- Restores the definitions of 20261007090000_free_limits.sql and 20261006130000_apply_stripe_event.sql.
-- Not a migration: it lives outside supabase/migrations so it never runs on its own.

-- The view loses columns: dropped and created again.
drop view public.entitlements;
create view public.entitlements
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

create or replace function public.has_pro(p_user uuid)
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

create or replace function public.apply_stripe_event(p_event_id text, p_type text, p_created timestamptz, p_change jsonb)
returns text
language plpgsql
-- Runs as its owner to check the user in auth.users; callable by the service role only (below).
security definer
set search_path = ''
as $$
declare
  v_kind text := p_change ->> 'kind';
  v_customer text := p_change ->> 'customerId';
  v_user uuid;
  v_current public.subscriptions%rowtype;
  v_status text;
begin
  if jsonb_typeof(p_change) is distinct from 'object' then
    raise exception 'apply_stripe_event: invalid payload' using errcode = '22023';
  end if;

  -- The user: given by the subscription's metadata (Checkout), else known from the customer.
  v_user := nullif(p_change ->> 'userId', '')::uuid;
  if v_user is null and v_customer is not null then
    select s.user_id into v_user from public.subscriptions s where s.stripe_customer_id = v_customer;
  end if;

  insert into public.stripe_events (id, type, user_id)
  values (p_event_id, p_type, (select u.id from auth.users u where u.id = v_user))
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if v_kind not in ('subscription', 'payment_failed') then
    return 'ignored';
  end if;
  if v_user is null or not exists (select 1 from auth.users u where u.id = v_user) then
    return 'unknown_customer';
  end if;

  select * into v_current from public.subscriptions s where s.user_id = v_user for update;

  if found and v_current.last_event_at is not null and p_created < v_current.last_event_at then
    return 'stale';
  end if;

  if v_kind = 'payment_failed' then
    if not found then
      return 'unknown_customer';
    end if;
    -- The grace period starts at the first failure; the subscription event sets the status.
    update public.subscriptions s
    set past_due_since = coalesce(s.past_due_since, p_created)
    where s.user_id = v_user;
    return 'applied';
  end if;

  v_status := p_change ->> 'status';
  insert into public.subscriptions as s (
    user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
    current_period_end, cancel_at_period_end, past_due_since, last_event_at
  )
  values (
    v_user,
    v_customer,
    nullif(p_change ->> 'subscriptionId', ''),
    v_status,
    nullif(p_change ->> 'priceId', ''),
    nullif(p_change ->> 'currentPeriodEnd', '')::timestamptz,
    coalesce((p_change ->> 'cancelAtPeriodEnd')::boolean, false),
    case when v_status = 'past_due' then p_created end,
    p_created
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    price_id = excluded.price_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    -- Kept while still past_due (counted from the first failure), cleared once it is not.
    past_due_since = case
      when excluded.status = 'past_due' then coalesce(s.past_due_since, excluded.past_due_since)
      else null
    end,
    last_event_at = excluded.last_event_at;
  return 'applied';
end;
$$;


drop function public.subscription_has_pro(text, timestamptz, timestamptz, timestamptz);
alter table public.subscriptions drop column payment_failed_at, drop column payment_url;
