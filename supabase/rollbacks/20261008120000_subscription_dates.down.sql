-- Reverts 20261008120000_subscription_dates.sql (issue #160).
drop trigger subscriptions_track_dates on public.subscriptions;
drop function public.subscriptions_track_dates();
alter table public.subscriptions drop column paying_since, drop column ended_at;
