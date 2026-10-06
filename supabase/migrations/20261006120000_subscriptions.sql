-- Subscription schema (issue #138, US-1 of the monetization epic #150): each user's Stripe
-- subscription, the Stripe events already handled, and the rights derived from them.
-- Written only by the Stripe webhook (service role, US-5); a user can only read their own row, so
-- nobody can grant themselves Pro from the browser.
-- Revert: supabase/rollbacks/20261006120000_subscriptions.down.sql.

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  -- Stripe's subscription status, as received.
  status text not null check (
    status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
  ),
  price_id text check (price_id ~ '^price_[A-Za-z0-9]+$'),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- When the subscription last became past_due (set by the webhook): the grace period counts from
  -- here, because Stripe has usually already moved current_period_end to the next period.
  past_due_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions (user_id);

create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Stripe events already handled: a replayed event is processed once (US-5). No user can read it.
create table public.stripe_events (
  id text primary key check (id ~ '^evt_[A-Za-z0-9]+$'),
  type text not null check (char_length(type) between 1 and 100),
  -- The user the event was about, when known; the row goes with the account.
  user_id uuid references auth.users (id) on delete cascade,
  received_at timestamptz not null default now()
);
create index stripe_events_user_id_idx on public.stripe_events (user_id);

alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.subscriptions, public.stripe_events from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant all on public.subscriptions, public.stripe_events to service_role;

-- Read only, own row; no insert / update / delete policy for users (the webhook uses the service role).
create policy "subscriptions_select_own" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

-- Days of Pro kept after a failed renewal (US-7 may tune it).
create function public.billing_grace_days()
returns integer
language sql
immutable
set search_path = ''
as $$ select 7 $$;

-- Pro at a given time: trialing or active, or past_due within the grace period.
create function public.subscription_is_pro(p_status text, p_past_due_since timestamptz, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status in ('trialing', 'active')
    or (
      p_status = 'past_due'
      and p_at < coalesce(p_past_due_since, p_at) + make_interval(days => public.billing_grace_days())
    )
$$;

-- The signed-in user's rights: one row per user who has a subscription (none = Free).
create view public.entitlements
with (security_invoker = true)
as
select
  s.user_id,
  s.status,
  s.current_period_end,
  s.cancel_at_period_end,
  public.subscription_is_pro(s.status, s.past_due_since, now()) as is_pro
from public.subscriptions s;

revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
grant select on public.entitlements to service_role;
revoke execute on function public.subscription_is_pro(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.subscription_is_pro(text, timestamptz, timestamptz) to authenticated, service_role;
revoke execute on function public.billing_grace_days() from public, anon;
grant execute on function public.billing_grace_days() to authenticated, service_role;
