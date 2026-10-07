# Back-office (epic #161)

`/admin/` on the website (not in the menu, not in the Android app) manages accounts and
subscriptions. **Absolute rule:** no access to users' financial data (budget, loans, goals,
check-ins, statements); only account and subscription information, plus two counts per account
(loans, goals).

## How access is checked (US-13, #156)

Every admin action goes through the Edge Function `admin` (JWT verification on). It:

1. checks the session (401 without one);
2. checks the caller is in the `admins` table, read on every call, so a removal is immediate
   (403 « forbidden » otherwise);
3. checks the session passed the **TOTP second factor** (`aal2`; 403 « mfa_required » otherwise);
4. only then uses the service role. The caller's identity comes from the JWT only.

Every action that changes something, and every export, is written to `admin_audit` (append-only,
kept 12 months, ids only). Admins are added and removed in the back-office; nobody removes
themselves or the last admin.

## First admin (owner, once)

The repository is public, so no e-mail address is in a migration. In the Supabase dashboard →
SQL Editor, after the migration `20261008090000_admin.sql` is applied:

```sql
insert into public.admins (user_id)
select id from auth.users where email = '<your e-mail>';
```

Then open `https://ghassenazzouz.github.io/finance/admin/`, scan the QR code with an
authenticator app (Google Authenticator, 1Password…) and enter its code. Next visits only ask for
the code.

Check once that TOTP is on for the hosted project: Supabase dashboard → Authentication →
Multi-Factor (or Sign In / Providers → MFA) → **TOTP enabled** (enroll and verify).

## Owner decisions (2026-10-07)

See issues #156–#160 (« Décisions » tables): admin list managed in the back-office, TOTP
mandatory, audit of changes and exports for 12 months, CSV export of the user list, mandatory
reason for an offered Pro, e-mail after an account deletion (no refund, Stripe customer kept),
estimated MRR on the dashboard.
