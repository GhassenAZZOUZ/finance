-- Grace period and dunning (issue #144, US-7 of epic #150; owner decisions 2026-10-09, SPEC D35).
-- 1. The 7-day grace period applies only to a subscription that was paid before (`paying_since`,
--    #160): a trial ending with a declined card ends Pro at once.
-- 2. `invoice.payment_failed` keeps Stripe's payment page of the unpaid invoice (`payment_url`, it
--    also handles 3-D Secure) and the time of the first failure (`payment_failed_at`); it answers
--    'dunning' the first time, and the webhook then sends the one dunning e-mail.
-- 3. A late failure event no longer overrides a recovered payment; a failure that arrives just
--    before the subscription's own past_due event still counts.
-- 4. `entitlements` gains what the banner needs: `payment_problem` ('grace' / 'lapsed'),
--    `grace_ends_at` and `payment_url`.
-- subscription_is_pro(text, timestamptz, timestamptz) is no longer used (kept: dropping it would be
-- a destructive migration); subscription_has_pro replaces it.
-- Revert: supabase/rollbacks/20261009090000_grace_dunning.down.sql

alter table public.subscriptions
  add column payment_failed_at timestamptz,
  add column payment_url text check (payment_url ~ '^https://');

create function public.subscription_has_pro(p_status text, p_past_due_since timestamptz, p_paying_since timestamptz, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('trialing', 'active')
    or (
      p_status = 'past_due'
      and p_paying_since is not null
      and p_at < coalesce(p_past_due_since, p_at) + make_interval(days => public.billing_grace_days())
    )
$$;
revoke execute on function public.subscription_has_pro(text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.subscription_has_pro(text, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

create or replace view public.entitlements
with (security_invoker = true)
as
select
  coalesce(s.user_id, g.user_id) as user_id,
  coalesce(s.status, 'granted') as status,
  s.current_period_end,
  coalesce(s.cancel_at_period_end, false) as cancel_at_period_end,
  (s.user_id is not null and public.subscription_has_pro(s.status, s.past_due_since, s.paying_since, now()))
    or (g.user_id is not null and (g.expires_at is null or g.expires_at > now())) as is_pro,
  g.reason as grant_reason,
  -- 'grace': payment failed, still Pro until grace_ends_at; 'lapsed': unpaid and no longer Pro by
  -- this subscription (grace over, or a trial that was never paid).
  case
    when s.status in ('past_due', 'unpaid') then
      case when public.subscription_has_pro(s.status, s.past_due_since, s.paying_since, now()) then 'grace' else 'lapsed' end
  end as payment_problem,
  case
    when s.status = 'past_due' and s.paying_since is not null and s.past_due_since is not null then
      s.past_due_since + make_interval(days => public.billing_grace_days())
  end as grace_ends_at,
  case when s.status in ('past_due', 'unpaid') then s.payment_url end as payment_url
from public.subscriptions s
full join public.pro_grants g on g.user_id = s.user_id;

create or replace function public.has_pro(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user and public.subscription_has_pro(s.status, s.past_due_since, s.paying_since, now())
  ) or exists (
    select 1 from public.pro_grants g
    where g.user_id = p_user and (g.expires_at is null or g.expires_at > now())
  )
$$;

-- p_change for invoice.payment_failed is now { kind: "payment_failed", customerId, paymentUrl }.
-- Returns 'duplicate', 'applied', 'dunning' (first failure of this unpaid period: send the e-mail),
-- 'stale', 'unknown_customer' or 'ignored'.
create or replace function public.apply_stripe_event(p_event_id text, p_type text, p_created timestamptz, p_change jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := p_change ->> 'kind';
  v_customer text := p_change ->> 'customerId';
  v_user uuid;
  v_current public.subscriptions%rowtype;
  v_status text;
  v_url text;
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

  if v_kind = 'payment_failed' then
    if not found then
      return 'unknown_customer';
    end if;
    -- A failure older than a later state that is no longer unpaid (a recovered payment): ignored.
    if v_current.last_event_at is not null and p_created < v_current.last_event_at
       and v_current.status not in ('past_due', 'unpaid') then
      return 'stale';
    end if;
    v_url := nullif(p_change ->> 'paymentUrl', '');
    if v_url is not null and v_url !~ '^https://' then
      v_url := null;
    end if;
    -- The grace period starts at the first failure; later retries change neither it nor the e-mail.
    update public.subscriptions s
    set past_due_since = coalesce(s.past_due_since, p_created),
        payment_failed_at = coalesce(s.payment_failed_at, p_created),
        payment_url = coalesce(v_url, s.payment_url)
    where s.user_id = v_user;
    return case when v_current.payment_failed_at is null then 'dunning' else 'applied' end;
  end if;

  if found and v_current.last_event_at is not null and p_created < v_current.last_event_at then
    return 'stale';
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
    -- Kept while unpaid (counted from the first failure). Cleared once paid again, unless the
    -- failure is newer than this event (it arrived first: Stripe sends both at once).
    past_due_since = case
      when excluded.status = 'past_due' then coalesce(s.past_due_since, excluded.past_due_since)
      when s.payment_failed_at is not null and excluded.last_event_at < s.payment_failed_at then s.past_due_since
      else null
    end,
    payment_failed_at = case
      when excluded.status in ('past_due', 'unpaid') then s.payment_failed_at
      when s.payment_failed_at is not null and excluded.last_event_at < s.payment_failed_at then s.payment_failed_at
      else null
    end,
    payment_url = case
      when excluded.status in ('past_due', 'unpaid') then s.payment_url
      when s.payment_failed_at is not null and excluded.last_event_at < s.payment_failed_at then s.payment_url
      else null
    end,
    last_event_at = excluded.last_event_at;
  return 'applied';
end;
$$;
