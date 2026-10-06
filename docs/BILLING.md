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
| Edge Function `create-checkout` (user JWT) and pages `/abonnement/`, `/abonnement/succes/`, `/abonnement/annule/` | `supabase/functions/create-checkout/`, `app/(app)/abonnement/` | #141 US-4 |

## Rights (SPEC D35)

`is_pro` = `trialing` or `active`, or `past_due` during 7 days from the first failed payment
(`billing_grace_days()`). No subscription = Free.

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
5. Later stories add the Customer Portal (US-6) and Smart Retries (US-7).
