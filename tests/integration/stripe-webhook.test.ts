/**
 * Stripe webhook database side (issue #142, US-5): `apply_stripe_event` applies one event in one
 * transaction, idempotent on its id, ignoring stale events. Fake data. Requires `supabase start`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let a: TestUser;
let customer: string;
let n = 0;
const eventId = () => `evt_${Date.now()}${++n}`;

const apply = async (id: string, type: string, created: string, change: Record<string, unknown>) => {
  const { data, error } = await adminClient().rpc("apply_stripe_event", { p_event_id: id, p_type: type, p_created: created, p_change: change });
  if (error) throw new Error(error.message);
  return data as string;
};
const sub = (status: string, extra: Record<string, unknown> = {}) => ({
  kind: "subscription",
  customerId: customer,
  subscriptionId: `sub_${customer.slice(4)}`,
  status,
  priceId: "price_monthly",
  currentPeriodEnd: "2027-03-15T10:00:00Z",
  cancelAtPeriodEnd: false,
  ...extra,
});
const row = async () =>
  (await adminClient().from("subscriptions").select("status, past_due_since, last_event_at, cancel_at_period_end").eq("user_id", a.id).single()).data;

beforeEach(async () => {
  a = await createTestUser("stripe", { plan: "free" });
  customer = `cus_${a.id.replace(/-/g, "").slice(0, 12)}`;
});
afterEach(() => deleteTestUser(a));

describe("apply_stripe_event", () => {
  it("creates the subscription from Checkout's metadata, and a replay changes nothing", async () => {
    const id = eventId();
    expect(await apply(id, "customer.subscription.created", "2027-01-01T10:00:00Z", sub("trialing", { userId: a.id }))).toBe("applied");
    expect(await apply(id, "customer.subscription.created", "2027-01-01T10:00:00Z", sub("canceled"))).toBe("duplicate");
    expect((await row())?.status).toBe("trialing");
    const { data } = await a.client.from("entitlements").select("is_pro").single();
    expect(data?.is_pro).toBe(true);
  });

  it("finds the user from the customer, and ignores an event older than the last applied", async () => {
    await apply(eventId(), "customer.subscription.created", "2027-01-01T10:00:00Z", sub("trialing", { userId: a.id }));
    expect(await apply(eventId(), "customer.subscription.updated", "2027-01-15T10:00:00Z", sub("active"))).toBe("applied");
    expect(await apply(eventId(), "customer.subscription.updated", "2027-01-10T10:00:00Z", sub("trialing"))).toBe("stale");
    expect((await row())?.status).toBe("active");
  });

  it("starts the grace period at the first failure, keeps it while past_due, clears it once paid", async () => {
    await apply(eventId(), "customer.subscription.created", "2027-01-01T10:00:00Z", sub("active", { userId: a.id }));
    expect(await apply(eventId(), "invoice.payment_failed", "2027-02-15T10:00:00Z", { kind: "payment_failed", customerId: customer })).toBe("applied");
    expect(new Date((await row())!.past_due_since).toISOString()).toBe("2027-02-15T10:00:00.000Z");
    await apply(eventId(), "customer.subscription.updated", "2027-02-15T10:00:01Z", sub("past_due"));
    await apply(eventId(), "invoice.payment_failed", "2027-02-18T10:00:00Z", { kind: "payment_failed", customerId: customer });
    expect(new Date((await row())!.past_due_since).toISOString()).toBe("2027-02-15T10:00:00.000Z");
    await apply(eventId(), "customer.subscription.updated", "2027-02-19T10:00:00Z", sub("active"));
    expect((await row())?.past_due_since).toBeNull();
  });

  it("records cancellation at period end, then the end of the subscription", async () => {
    await apply(eventId(), "customer.subscription.created", "2027-01-01T10:00:00Z", sub("active", { userId: a.id }));
    await apply(eventId(), "customer.subscription.updated", "2027-01-20T10:00:00Z", sub("active", { cancelAtPeriodEnd: true }));
    expect((await row())?.cancel_at_period_end).toBe(true);
    await apply(eventId(), "customer.subscription.deleted", "2027-02-01T10:00:00Z", sub("canceled", { cancelAtPeriodEnd: true }));
    const { data } = await a.client.from("entitlements").select("is_pro").single();
    expect(data?.is_pro).toBe(false);
  });

  it("acknowledges an unknown customer and the other events without touching any subscription", async () => {
    expect(await apply(eventId(), "customer.subscription.updated", "2027-01-01T10:00:00Z", { ...sub("active"), customerId: "cus_unknown" })).toBe(
      "unknown_customer",
    );
    expect(await apply(eventId(), "charge.succeeded", "2027-01-01T10:00:00Z", { kind: "ignored" })).toBe("ignored");
    expect(await row()).toBeNull();
  });

  it("security — a signed-in user cannot call it", async () => {
    const { error } = await a.client.rpc("apply_stripe_event", {
      p_event_id: "evt_forged",
      p_type: "customer.subscription.created",
      p_created: "2027-01-01T10:00:00Z",
      p_change: sub("active", { userId: a.id }),
    });
    expect(error).not.toBeNull();
    expect(await row()).toBeNull();
  });
});
