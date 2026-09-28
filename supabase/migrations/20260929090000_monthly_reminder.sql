-- Monthly check-in reminder by e-mail (docs/SPEC.md D25, issue #6).
-- The Edge Function `monthly-reminder` (service role) sends it on the last day of the month to the
-- users who have it on, have a plan, and have not entered that month's check-in yet.

alter table public.profiles
  add column reminder_enabled boolean not null default true,
  -- Secret of the unsubscribe link (no login needed); regenerated never, unique per user.
  add column reminder_token uuid not null default gen_random_uuid() unique;

-- One row per user and month: written before sending, so a retried job never sends twice.
create table public.reminder_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  month public.year_month not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.reminder_log enable row level security;
-- No policy: only the service role (which bypasses RLS) reads or writes it.
revoke all on public.reminder_log from anon, authenticated;
grant all on public.reminder_log to service_role;

-- Who gets this month's reminder. Service role only (it reads auth.users for the address).
create function public.reminder_recipients(p_month public.year_month)
returns table (user_id uuid, email text, token uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, u.email::text, p.reminder_token
  from public.profiles p
  join auth.users u on u.id = p.user_id
  join public.budget_settings s on s.user_id = p.user_id
  where p.reminder_enabled
    and u.email is not null
    and s.start_month <= p_month
    and not exists (select 1 from public.monthly_actuals a where a.user_id = p.user_id and a.month = p_month)
    and not exists (select 1 from public.reminder_log l where l.user_id = p.user_id and l.month = p_month);
$$;
revoke execute on function public.reminder_recipients(public.year_month) from public, anon, authenticated;
grant execute on function public.reminder_recipients(public.year_month) to service_role;

-- Unsubscribe link: turns the reminder off for the token's owner only. Callable without login;
-- an unknown or tampered token changes nothing and returns false.
create function public.unsubscribe_reminder(p_token uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with updated as (
    update public.profiles set reminder_enabled = false where reminder_token = p_token returning 1
  )
  select exists (select 1 from updated);
$$;
revoke execute on function public.unsubscribe_reminder(uuid) from public;
grant execute on function public.unsubscribe_reminder(uuid) to anon, authenticated, service_role;
