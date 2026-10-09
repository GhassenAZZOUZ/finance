# Billing (monetization epic #150)

Boussole's Pro plan is a Stripe subscription. The app never decides who is Pro: the Stripe webhook
writes each user's subscription, the database derives the rights (SPEC D35), and the app only reads
them.

## Pieces

| Piece | Where | Story |
|---|---|---|
| `subscriptions`, `stripe_events`, view `entitlements` | `supabase/migrations/20261006120000_subscriptions.sql` | #138 US-1 |
| `apply_stripe_event()` (one event, one transaction, idempotent) | `supabase/migrations/20261006130000_apply_stripe_event.sql` | #142 US-5 |
| Edge Function `stripe-webhook` (signature, mapping) | `supabase/functions/stripe-webhook/` | #142 US-5 |
| `plan_limits`, `pro_grants`, limit triggers | `supabase/migrations/20261007090000_free_limits.sql` | #139 US-2 |
| Edge Function `create-checkout` (user JWT) and pages `/abonnement/`, `/abonnement/succes/`, `/abonnement/annule/` | `supabase/functions/create-checkout/`, `app/(app)/abonnement/` | #141 US-4 |

## Rights (SPEC D35)

`is_pro` = a Stripe subscription `trialing` or `active` (or `past_due` during 7 days from the first
failed payment, `billing_grace_days()`, **only if it was paid before**: a trial ending with a declined
card is Free at once, #144), **or** a `pro_grants` row not expired. Otherwise Free
(`subscription_has_pro()`).
Every account that existed when the Free limits shipped got a grant `early_user` (owner decision
2026-10-07). Grants are written by the service role only (dashboard SQL), e.g. a gift:
`insert into public.pro_grants (user_id, reason) values ('<user id>', 'gift');`

## Free limits (US-2)

| Limit | Free | Where |
|---|---|---|
| Active loans | 1 | trigger on `loans` (insert, re-activation) |
| Savings goals | 1 | trigger on `savings_goals` (insert) |
| Check-in history shown | last 3 months | interface only (every check-in feeds the balances, D33) |
| Plan horizon shown | 3 months from this month | interface only (the plan is computed in the browser) |
| Dashboard projections | locked card | interface only (#145) |
| Tags on budget lines | Pro only | trigger on `budget_lines.tag` (`tags_limit`) |
| Reports (`/rapports/`) | Pro only | interface only (computed in the browser from the check-ins) |

The numbers live in `plan_limits`. Beyond a database limit the insert is refused with SQLSTATE
`PT402` (PostgREST answers **HTTP 402**) and the limit key as message (`loans_limit`,
`goals_limit`); the app turns it into the paywall (`limitOf()` in `lib/errors.ts`, US-3).

## Webhook

- URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` (deployed by CI with the
  other Edge Functions, without JWT check: the Stripe signature is the guard).
- Events to send: `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`.
- Each event is recorded by id before anything else: a replayed event changes nothing. An event older
  than the last one applied to a subscription is ignored (Stripe does not guarantee the order).
- The user is `subscription.metadata.user_id`, which Checkout (US-4) sets; otherwise the user already
  known for the Stripe customer. An unknown customer is acknowledged and ignored.
- Responses: 400 bad signature or payload (Stripe stops), 500 not applied (Stripe retries), 200 otherwise.

## Failed payment (US-7, #144; owner decisions 2026-10-09)

- `invoice.payment_failed` starts the 7-day grace period at the first failure, keeps the invoice's
  Stripe payment page (`hosted_invoice_url`, which also handles 3-D Secure) and, the first time only,
  sends **one** dunning e-mail from Boussole (same SMTP secrets as the monthly reminder, plus
  `APP_URL`): « Votre paiement Boussole Pro a échoué », with the grace end date and the « Régler le
  paiement » link; for a trial ending unpaid, that the account is Free now. A replay, a later retry or
  a failure older than a recovered payment sends nothing. A send failure is logged, never retried.
- A banner « Paiement échoué » is shown above every page, not dismissible, until the payment is
  settled: Pro until the grace end, then « repassé en Free ». In the Android app it has no payment
  link (Google Play rules) and says to pay from the website.
- Paid again (`customer.subscription.updated` → `active`): the banner and the grace fields go.
- After Stripe's last retry the subscription is **cancelled** (`customer.subscription.deleted`): Free,
  no banner, and the user can subscribe again through Checkout.

## Checkout (US-4)

- Plans: **4,99 €/month** and **39 €/year**, **14-day trial** on a user's first subscription only
  (owner decision 2026-10-06). The prices shown are in `lib/billing/client.ts`; what is charged is the
  Stripe price of each plan.
- `create-checkout` reads the caller from their JWT, refuses a user already trialing / active /
  past_due, reuses their Stripe customer, and sets `client_reference_id` and
  `subscription_data.metadata.user_id` (read by the webhook).
- The success page only waits for the webhook (polls `entitlements` every 2 s for 30 s): paying never
  grants Pro by itself.
- **Android app:** no purchase is offered (Google Play requires its own billing for digital
  subscriptions and restricts pointing to an outside payment page). Pro bought on the website is
  active in the app. Selling inside the app later means Google Play Billing.

## Owner setup (test mode first)

1. Create the Stripe account (test mode is enough to develop and test).
2. Developers → Webhooks → Add endpoint: the URL above, the four events above.
3. Copy the endpoint's signing secret and store it in Supabase:
   `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_… --project-ref <project-ref>`.
   Never in the repository.
4. Products → add « Boussole Pro » with two recurring prices (4,99 € monthly, 39 € yearly), then:
   `supabase secrets set STRIPE_SECRET_KEY=sk_test_… STRIPE_PRICE_MONTHLY=price_… STRIPE_PRICE_YEARLY=price_… APP_URL=https://ghassenazzouz.github.io/finance --project-ref <project-ref>`.
   Until then « S’abonner » answers « Le paiement n’est pas encore ouvert ».
5. Failed payments (US-7): Settings → Billing → Subscriptions and emails → **Smart Retries** on
   (default window), and « If all retries for a payment fail »: **cancel the subscription**. Turn off
   Stripe's own « failed payment » customer e-mails (Boussole sends its own). Set the SMTP secrets of
   the reminder on the project if not done (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
   `SMTP_FROM`). Test with the card `4000 0000 0000 0341` (attaches, then declines).
6. A later story adds the Customer Portal (US-6).
