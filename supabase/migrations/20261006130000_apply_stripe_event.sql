-- Stripe webhook (issue #142, US-5): one verified event applied in one transaction by the Edge
-- Function `stripe-webhook` (service role only). The event id is recorded first: a replayed event
-- changes nothing. Events can arrive out of order: one older than the last applied to a
-- subscription is ignored. `past_due_since` starts the grace period (SPEC D35).
-- Revert: drop function public.apply_stripe_event(text, text, timestamptz, jsonb);
--         alter table public.subscriptions drop column last_event_at;

alter table public.subscriptions add column last_event_at timestamptz;

-- p_change (camelCase, from supabase/functions/stripe-webhook/logic.ts):
--   subscription events: { kind: "subscription", userId, customerId, subscriptionId, status, priceId,
--                          currentPeriodEnd, cancelAtPeriodEnd }
--   invoice.payment_failed: { kind: "payment_failed", customerId }
--   anything else: { kind: "ignored" }
-- Returns 'duplicate', 'applied', 'stale' (older than the last applied), 'unknown_customer' or 'ignored'.
create function public.apply_stripe_event(p_event_id text, p_type text, p_created timestamptz, p_change jsonb)
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

revoke execute on function public.apply_stripe_event(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, timestamptz, jsonb) to service_role;
