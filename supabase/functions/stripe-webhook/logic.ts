/**
 * Stripe webhook rules (issue #142, US-5): signature check and the subscription row an event leads
 * to. Pure functions (Web Crypto only), shared by the Edge Function (Deno) and the unit tests (Node).
 */

/** Stripe's default tolerance on the signed timestamp, in seconds (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/**
 * Checks the `Stripe-Signature` header (`t=…,v1=…[,v1=…]`): one v1 must be the HMAC-SHA256 of
 * `${t}.${payload}` with the endpoint secret, and t within the tolerance of `nowSeconds`.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  tolerance = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k, v]) => k === "v1" && v).map(([, v]) => v!);
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return signatures.some((s) => sameHex(s, expected));
}

/** What the database function `apply_stripe_event` receives for one event. */
export interface SubscriptionChange {
  userId: string | null;
  customerId: string;
  subscriptionId: string | null;
  status: string;
  priceId: string | null;
  /** ISO timestamp, or null when Stripe did not send it. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export type EventAction =
  | { kind: "subscription"; change: SubscriptionChange }
  /** paymentUrl: Stripe's page to pay the unpaid invoice (also handles 3-D Secure), #144. */
  | { kind: "payment_failed"; customerId: string; paymentUrl: string | null }
  | { kind: "ignored" };

export const HANDLED_EVENTS = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
/** A Stripe reference: the id string, or an expanded object with an id. */
const ref = (v: unknown): string | null => str(v) ?? (isObj(v) ? str(v.id) : null);
const seconds = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The subscription row a Stripe subscription object leads to. The user comes from
 * `metadata.user_id`, set by Checkout (US-4); without it the database finds the user by customer.
 * The period end is on the subscription (older API versions) or on its first item (2025+ versions).
 */
export function subscriptionChange(subscription: Obj): SubscriptionChange | null {
  const customerId = ref(subscription.customer);
  const status = str(subscription.status);
  if (!customerId || !status) return null;
  const items = isObj(subscription.items) && Array.isArray(subscription.items.data) ? subscription.items.data.filter(isObj) : [];
  const first = items[0];
  const userId = isObj(subscription.metadata) ? str(subscription.metadata.user_id) : null;
  return {
    userId: userId && UUID.test(userId) ? userId : null,
    customerId,
    subscriptionId: str(subscription.id),
    status,
    priceId: first && isObj(first.price) ? str(first.price.id) : null,
    currentPeriodEnd: seconds(subscription.current_period_end) ?? (first ? seconds(first.current_period_end) : null),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
  };
}

/** What to do with a verified event; anything else is acknowledged and ignored. */
export function eventAction(event: Obj): EventAction {
  const type = str(event.type);
  const object = isObj(event.data) && isObj(event.data.object) ? event.data.object : null;
  if (!type || !object) return { kind: "ignored" };
  if (type.startsWith("customer.subscription.") && (HANDLED_EVENTS as readonly string[]).includes(type)) {
    const change = subscriptionChange(object);
    return change ? { kind: "subscription", change } : { kind: "ignored" };
  }
  if (type === "invoice.payment_failed") {
    const customerId = ref(object.customer);
    const url = str(object.hosted_invoice_url);
    return customerId ? { kind: "payment_failed", customerId, paymentUrl: url && url.startsWith("https://") ? url : null } : { kind: "ignored" };
  }
  return { kind: "ignored" };
}

const GRACE_DAYS = 7;
const longDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

/** The day the grace period started at `pastDueSince` ends (same time, 7 days later), Paris. */
export function graceEndDay(pastDueSince: string): string {
  return longDate.format(new Date(new Date(pastDueSince).getTime() + GRACE_DAYS * 86_400_000));
}

/**
 * The one dunning e-mail of an unpaid period (issue #144, owner decision 2026-10-09: Boussole sends
 * it, once, at the first failure). A paid subscription keeps Pro during the grace period; a trial
 * ending unpaid is Free at once. No card data: only the link to Stripe's payment page.
 */
export function dunningEmail(input: { paidBefore: boolean; pastDueSince: string; paymentUrl: string | null; appUrl: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const link = input.paymentUrl ?? `${input.appUrl.replace(/\/+$/, "")}/abonnement/`;
  const lines = input.paidBefore
    ? [
        "Bonjour,",
        "Le paiement de votre abonnement Boussole Pro n’a pas abouti.",
        `Votre accès Pro reste actif jusqu’au ${graceEndDay(input.pastDueSince)}. Réglez le paiement d’ici là pour le garder sans interruption.`,
      ]
    : [
        "Bonjour,",
        "Votre essai Boussole Pro est terminé, mais le premier paiement n’a pas abouti : votre compte est repassé en Free. Vos données sont conservées.",
        "Réglez le paiement pour retrouver Pro.",
      ];
  const after = "Sans règlement, l’abonnement sera résilié automatiquement après les nouvelles tentatives de paiement.";
  return {
    subject: input.paidBefore ? "Votre paiement Boussole Pro a échoué" : "Votre essai Boussole Pro est terminé : paiement non abouti",
    text: [...lines, `Régler le paiement : ${link}`, after].join("\n\n"),
    html: [...lines.map((l) => `<p>${l}</p>`), `<p><a href="${link}">Régler le paiement</a></p>`, `<p style="color:#666;font-size:12px">${after}</p>`].join("\n"),
  };
}
