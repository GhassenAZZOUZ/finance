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

## User list (US-14, #157)

« Utilisateurs »: e-mail, sign-up, last sign-in, plan (Pro payant > Essai > Pro offert > Free),
subscription status and period end, number of loans and goals. Partial e-mail search ignoring case,
filters by plan and status (« résiliation programmée » included), sort by sign-up (default) or last
sign-in, 50 per page. « Exporter en CSV » downloads the filtered list (`;`, UTF-8 with BOM, spreadsheet
formulas neutralised); each export is written to the audit log with its filters and count. Viewing
the list is not audited.

## Offer or remove Pro (US-15, #158)

« Gérer » on a row opens the account's plan: the offered Pro (at launch or by an admin, end date) and
a link to the customer in Stripe (a Stripe subscription is never changed from the back-office).
« Offrir Pro » needs a reason (1–200 characters); the end date is optional and included until 23:59
Paris time; a past date is refused. On an account already Pro (paying, trial or offered) the admin
confirms first, and the new end date replaces the current one. « Retirer le Pro offert » asks for a
confirmation; a paying subscription stays. Nobody changes their own plan. Both actions are written to
the audit log (reason, end date, previous plan). The user receives no e-mail.

## Delete an account (US-16, #159)

At the owner's request (GDPR erasure), « Gérer » › « Supprimer le compte »: the admin types a
reference of the request (e.g. the date and sender of the e-mail received, 1–200 characters) and the
account's e-mail (case and surrounding spaces ignored); the server checks both again. In this order:

1. Stripe (if the account has a customer): an active, trial or past-due subscription is cancelled
   immediately, without refund nor final invoice; the customer is kept for accounting (invoices are
   kept 10 years) and marked `account_deleted = <date>` in its metadata. If Stripe fails, nothing is
   deleted.
2. `delete_user_account()` (service role only) deletes the account exactly like « Supprimer mon
   compte ». If it fails after Stripe, the admin sees it and runs the deletion again (Stripe is not
   cancelled twice).
3. The audit log records the account id, the request reference and whether a subscription was
   cancelled, never the e-mail; the entry survives the deletion.
4. The user receives « Votre compte Boussole a été supprimé » (same SMTP secrets as the monthly
   reminder); if it cannot be sent, the admin is told.

Nobody deletes their own account here (« Supprimer mon compte ») nor another admin's (remove them
from the admins first). « Supprimer mon compte » also cancels Stripe the same way, through the
`delete-account` Edge Function, when the user has a Stripe customer.

The `admin` and `delete-account` functions read the project secrets `STRIPE_SECRET_KEY` and `SMTP_*`
already set for Checkout (docs/BILLING.md) and the monthly reminder (README.md).

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
