/** Stripe webhook rules (issue #142, US-5): signature check and event mapping. Invented data only. */
import { describe, expect, it } from "vitest";
import { eventAction, hmacSha256Hex, subscriptionChange, verifyStripeSignature } from "@/supabase/functions/stripe-webhook/logic";

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000;
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
const header = async (t: number, payload = PAYLOAD, secret = SECRET) => `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${payload}`)}`;

describe("verifyStripeSignature", () => {
  it("accepts Stripe's signature of the exact payload", async () => {
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW), SECRET, NOW)).toBe(true);
    // Several v1 (secret rotation): one valid is enough.
    expect(await verifyStripeSignature(PAYLOAD, `${await header(NOW)},v1=deadbeef`, SECRET, NOW)).toBe(true);
  });

  it("rejects another secret, a changed payload, a missing header or a malformed one", async () => {
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW, PAYLOAD, "whsec_other"), SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(`${PAYLOAD} `, await header(NOW), SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(PAYLOAD, null, SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(PAYLOAD, "v1=abc", SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(PAYLOAD, `t=${NOW}`, SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW), "", NOW)).toBe(false);
  });

  it("rejects a signature older or newer than 5 minutes (replay)", async () => {
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW - 300), SECRET, NOW)).toBe(true);
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW - 301), SECRET, NOW)).toBe(false);
    expect(await verifyStripeSignature(PAYLOAD, await header(NOW + 301), SECRET, NOW)).toBe(false);
  });
});

const USER = "11111111-2222-3333-4444-555555555555";
const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: { user_id: USER },
  items: { data: [{ price: { id: "price_monthly" }, current_period_end: NOW }] },
  ...over,
});

describe("subscriptionChange", () => {
  it("maps a subscription (period end on the item, 2025+ API)", () => {
    expect(subscriptionChange(subscription())).toEqual({
      userId: USER,
      customerId: "cus_1",
      subscriptionId: "sub_1",
      status: "active",
      priceId: "price_monthly",
      currentPeriodEnd: new Date(NOW * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it("reads the period end on the subscription (older API), an expanded customer, cancel at period end", () => {
    const change = subscriptionChange(
      subscription({ current_period_end: NOW + 60, customer: { id: "cus_2" }, cancel_at_period_end: true, items: { data: [] } }),
    );
    expect(change).toMatchObject({ customerId: "cus_2", currentPeriodEnd: new Date((NOW + 60) * 1000).toISOString(), cancelAtPeriodEnd: true, priceId: null });
  });

  it("leaves the user to the database when the metadata has none or a malformed one", () => {
    expect(subscriptionChange(subscription({ metadata: {} }))?.userId).toBeNull();
    expect(subscriptionChange(subscription({ metadata: { user_id: "'; drop table x;--" } }))?.userId).toBeNull();
  });

  it("is null without a customer or a status", () => {
    expect(subscriptionChange(subscription({ customer: null }))).toBeNull();
    expect(subscriptionChange(subscription({ status: "" }))).toBeNull();
  });
});

describe("eventAction", () => {
  const event = (type: string, object: unknown) => ({ id: "evt_1", type, created: NOW, data: { object } });

  it.each(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"])("%s updates the subscription", (type) => {
    const action = eventAction(event(type, subscription({ status: type.endsWith("deleted") ? "canceled" : "active" })));
    expect(action.kind).toBe("subscription");
  });

  it("invoice.payment_failed starts the grace period of the customer", () => {
    expect(eventAction(event("invoice.payment_failed", { customer: "cus_1" }))).toEqual({ kind: "payment_failed", customerId: "cus_1" });
  });

  it("acknowledges and ignores the other events and malformed ones", () => {
    expect(eventAction(event("charge.succeeded", { id: "ch_1" })).kind).toBe("ignored");
    expect(eventAction(event("customer.subscription.trial_will_end", subscription())).kind).toBe("ignored");
    expect(eventAction({ type: "customer.subscription.updated" }).kind).toBe("ignored");
    expect(eventAction(event("invoice.payment_failed", {})).kind).toBe("ignored");
  });
});
