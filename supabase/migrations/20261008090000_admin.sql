-- Back-office administrators (issue #156, US-13 of epic #161; owner decisions 2026-10-07).
-- Admins are a table checked on every call (removal is immediate); the audit log keeps every admin
-- action that changes something and every export, for 12 months. Both are reachable by the service
-- role only: the Edge Function `admin` checks the caller (JWT, admin, TOTP second factor) first.
-- No admin function reads the financial tables, except `admin_usage_counts()` which returns two
-- numbers per account (owner decision: count-only exception).
-- The first admin is added by the owner in the SQL editor (docs/ADMIN.md), never in a migration.
-- Revert: drop function public.admin_usage_counts(uuid[]); drop function public.purge_admin_audit();
--         drop table public.admin_audit; drop table public.admins;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Who named this admin (kept as an id: the namer may be gone).
  added_by uuid,
  added_at timestamptz not null default now()
);

create table public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Ids only, kept after the accounts are deleted (owner decision): no e-mail, no other data.
  admin_id uuid not null,
  action text not null check (action ~ '^[a-z_.]+$' and char_length(action) <= 50),
  target_user uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 4096)
);
create index admin_audit_at_idx on public.admin_audit (at desc);

alter table public.admins enable row level security;
alter table public.admin_audit enable row level security;
-- No policy: users (anon, authenticated) can neither read nor write. The service role writes the
-- admins and appends to the audit log, but never edits or deletes an entry.
revoke all on public.admins, public.admin_audit from anon, authenticated;
grant select, insert, delete on public.admins to service_role;
revoke all on public.admin_audit from service_role;
grant select, insert on public.admin_audit to service_role;

-- 12-month retention (owner decision): the only way to delete audit entries, called by the Edge
-- Function on each logged action.
create function public.purge_admin_audit()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from public.admin_audit a where a.at < now() - interval '12 months' returning 1)
  select count(*)::integer from gone
$$;
revoke execute on function public.purge_admin_audit() from public, anon, authenticated;
grant execute on function public.purge_admin_audit() to service_role;

-- Count-only exception (owner decision, US-14): how many active loans and savings goals each
-- account has. Never an amount, a name or a date.
create function public.admin_usage_counts(p_users uuid[])
returns table (user_id uuid, loans integer, goals integer)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id,
    (select count(*)::integer from public.loans l where l.user_id = u.id and l.archived_at is null),
    (select count(*)::integer from public.savings_goals g where g.user_id = u.id)
  from unnest(p_users) as u(id)
$$;
revoke execute on function public.admin_usage_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_usage_counts(uuid[]) to service_role;
