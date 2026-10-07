-- Admin dashboard (issue #160, US-17; definitions in SPEC D37, shared with US-10). `subscriptions`
-- keeps one row per user, the current state only: these two dates keep when it changed, taken from
-- the Stripe event time (`last_event_at`) the webhook writes.
-- - paying_since: when the subscription became paid (owner decision: a trial is not a new
--   subscription, its switch to paid is). Set on the move to `active` from anything but
--   active / past_due (a recovered payment is not a new subscription).
-- - ended_at: the end of access (owner decision: a cancellation is dated at the end of access), set
--   when Stripe reports `canceled` (at the period end for a scheduled cancellation).
-- A new subscription after a cancellation clears both.
-- Revert: supabase/rollbacks/20261008120000_subscription_dates.down.sql

alter table public.subscriptions
  add column paying_since timestamptz,
  add column ended_at timestamptz;

create function public.subscriptions_track_dates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous text := case when tg_op = 'UPDATE' then old.status end;
  at timestamptz := coalesce(new.last_event_at, now());
begin
  if previous = 'canceled' and new.status <> 'canceled' then
    new.paying_since := null;
    new.ended_at := null;
  end if;
  if new.status = 'active' and (previous is null or previous not in ('active', 'past_due')) then
    new.paying_since := at;
  end if;
  if new.status = 'canceled' and previous is distinct from 'canceled' then
    new.ended_at := at;
  end if;
  return new;
end;
$$;

create trigger subscriptions_track_dates before insert or update of status on public.subscriptions
  for each row execute function public.subscriptions_track_dates();

-- Rows written before: their dates are unknown, the best estimates are used.
update public.subscriptions set paying_since = created_at where status in ('active', 'past_due');
update public.subscriptions set ended_at = updated_at where status = 'canceled';
