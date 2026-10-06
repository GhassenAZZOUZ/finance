-- Rollback of 20261006120000_subscriptions.sql (issue #138), to run by hand in one transaction:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f supabase/rollbacks/20261006120000_subscriptions.down.sql
-- then delete the migration from the history (supabase migration repair --status reverted 20261006120000).
-- Subscriptions and handled Stripe events are lost: export them first if any user has paid.
-- Not a migration: it lives outside supabase/migrations so it never runs on its own.

drop view public.entitlements;
drop function public.subscription_is_pro(text, timestamptz, timestamptz);
drop function public.billing_grace_days();
drop table public.stripe_events;
drop table public.subscriptions;
