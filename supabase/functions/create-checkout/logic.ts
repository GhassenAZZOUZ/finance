/**
 * Stripe Checkout session for the Pro plan (issue #141, US-4). Pure: builds the form-encoded body
 * of `POST /v1/checkout/sessions`, shared by the Edge Function (Deno) and the unit tests (Node).
 */

export type Plan = "monthly" | "yearly";

/** 14-day free trial, on a user's first subscription only (owner decision 2026-10-06). */
export const TRIAL_DAYS = 14;

export function parsePlan(value: unknown): Plan | null {
  return value === "monthly" || value === "yearly" ? value : null;
}

export interface CheckoutInput {
  userId: string;
  email: string | null;
  plan: Plan;
  /** Price ids from the environment (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY). */
  prices: Record<Plan, string>;
  /** Base URL of the website, no trailing slash (APP_URL). */
  appUrl: string;
  /** The user's Stripe customer when they already had a subscription. */
  customerId: string | null;
  /** True when the user never had a subscription: the trial applies. */
  firstSubscription: boolean;
}

/** Stripe's form encoding of the Checkout session. */
export function checkoutParams(input: CheckoutInput): URLSearchParams {
  const p = new URLSearchParams();
  p.set("mode", "subscription");
  p.set("line_items[0][price]", input.prices[input.plan]);
  p.set("line_items[0][quantity]", "1");
  // The webhook (US-5) finds the user from the subscription's metadata.
  p.set("client_reference_id", input.userId);
  p.set("subscription_data[metadata][user_id]", input.userId);
  if (input.firstSubscription) p.set("subscription_data[trial_period_days]", String(TRIAL_DAYS));
  if (input.customerId) p.set("customer", input.customerId);
  else if (input.email) p.set("customer_email", input.email);
  // The success page only waits for the webhook: it never grants Pro itself.
  p.set("success_url", `${input.appUrl}/abonnement/succes/?session_id={CHECKOUT_SESSION_ID}`);
  p.set("cancel_url", `${input.appUrl}/abonnement/annule/`);
  p.set("locale", "fr");
  p.set("allow_promotion_codes", "true");
  return p;
}
