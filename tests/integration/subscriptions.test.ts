/**
 * Subscription schema (issue #138, US-1): rights per Stripe status, written only by the webhook
 * (service role), read by each user for themselves. Fake data, throwaway users. Requires `supabase start`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let a: TestUser;
let b: TestUser;

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function subscribe(user: TestUser, row: Record<string, unknown>) {
  const { error } = await adminClient()
    .from("subscriptions")
    .upsert({ user_id: user.id, stripe_customer_id: `cus_${user.id.slice(0, 8)}`, ...row });
  if (error) throw new Error(error.message);
}

async function isPro(user: TestUser): Promise<boolean | null> {
  const { data, error } = await user.client.from("entitlements").select("is_pro").maybeSingle<{ is_pro: boolean }>();
  if (error) throw new Error(error.message);
  return data?.is_pro ?? null;
}

beforeEach(async () => {
  [a, b] = await Promise.all([createTestUser("sub-a", { plan: "free" }), createTestUser("sub-b", { plan: "free" })]);
});
afterEach(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

describe("entitlements.is_pro", () => {
  it("is absent (Free) without a subscription", async () => {
    expect(await isPro(a)).toBeNull();
  });

  it.each([
    ["trialing", true],
    ["active", true],
    ["canceled", false],
    ["incomplete", false],
    ["incomplete_expired", false],
    ["unpaid", false],
    ["paused", false],
  ])("status %s → %s", async (status, expected) => {
    await subscribe(a, { status, current_period_end: iso(30 * DAY) });
    expect(await isPro(a)).toBe(expected);
  });

  it("past_due keeps Pro during the grace period only, even when the period end is far away", async () => {
    await subscribe(a, { status: "past_due", paying_since: iso(-40 * DAY), past_due_since: iso(-2 * DAY), current_period_end: iso(28 * DAY) });
    expect(await isPro(a)).toBe(true);
    await subscribe(a, { status: "past_due", paying_since: iso(-40 * DAY), past_due_since: iso(-8 * DAY), current_period_end: iso(22 * DAY) });
    expect(await isPro(a)).toBe(false);
  });

  it("a trial ending with a declined card has no grace period (#144, owner decision)", async () => {
    await subscribe(a, { status: "past_due", paying_since: null, past_due_since: iso(-1 * DAY), current_period_end: iso(29 * DAY) });
    expect(await isPro(a)).toBe(false);
  });

  it("tells the banner about a failed payment: grace with its end, then lapsed (#144)", async () => {
    const banner = async () =>
      (await a.client.from("entitlements").select("payment_problem, grace_ends_at, payment_url").single()).data as {
        payment_problem: string | null;
        grace_ends_at: string | null;
        payment_url: string | null;
      };
    const since = iso(-2 * DAY);
    await subscribe(a, { status: "past_due", paying_since: iso(-40 * DAY), past_due_since: since, payment_url: "https://invoice.stripe.com/i/test" });
    const grace = await banner();
    expect(grace.payment_problem).toBe("grace");
    expect(new Date(grace.grace_ends_at!).getTime()).toBe(new Date(since).getTime() + 7 * DAY);
    expect(grace.payment_url).toBe("https://invoice.stripe.com/i/test");
    await subscribe(a, { status: "past_due", paying_since: iso(-40 * DAY), past_due_since: iso(-8 * DAY) });
    expect((await banner()).payment_problem).toBe("lapsed");
    await subscribe(a, { status: "active", past_due_since: null, payment_url: null });
    expect(await banner()).toEqual({ payment_problem: null, grace_ends_at: null, payment_url: null });
  });

  it("an active subscription cancelled at period end stays Pro", async () => {
    await subscribe(a, { status: "active", cancel_at_period_end: true, current_period_end: iso(10 * DAY) });
    const { data } = await a.client.from("entitlements").select("is_pro, cancel_at_period_end").single();
    expect(data).toEqual({ is_pro: true, cancel_at_period_end: true });
  });

  it("subscription_has_pro: the grace period ends exactly 7 days after past_due_since", async () => {
    const since = "2027-01-10T12:00:00Z";
    const at = async (p_at: string) =>
      (await a.client.rpc("subscription_has_pro", { p_status: "past_due", p_past_due_since: since, p_paying_since: "2026-12-01T00:00:00Z", p_at })).data;
    expect(await at("2027-01-17T11:59:59Z")).toBe(true);
    expect(await at("2027-01-17T12:00:00Z")).toBe(false);
  });
});

describe("security", () => {
  it("a user cannot grant themselves Pro: no insert, update or delete of their subscription", async () => {
    const insert = await a.client.from("subscriptions").insert({ user_id: a.id, stripe_customer_id: "cus_fake", status: "active" });
    expect(insert.error).not.toBeNull();

    await subscribe(a, { status: "canceled" });
    const update = await a.client.from("subscriptions").update({ status: "active" }).eq("user_id", a.id).select();
    expect(update.data ?? []).toHaveLength(0);
    await a.client.from("subscriptions").delete().eq("user_id", a.id);
    expect(await isPro(a)).toBe(false);
    const { count } = await adminClient().from("subscriptions").select("user_id", { count: "exact", head: true }).eq("user_id", a.id);
    expect(count).toBe(1);
  });

  it("each user sees only their own rights; visitors see nothing", async () => {
    await subscribe(a, { status: "active" });
    const seenByB = await b.client.from("entitlements").select("user_id");
    expect(seenByB.data).toEqual([]);
    const subsSeenByB = await b.client.from("subscriptions").select("user_id");
    expect(subsSeenByB.data).toEqual([]);
    const anon = await anonClient().from("entitlements").select("user_id");
    expect(anon.data ?? []).toEqual([]);
  });

  it("stripe_events is out of reach of every user", async () => {
    const { error } = await adminClient().from("stripe_events").insert({ id: "evt_test1", type: "customer.subscription.updated", user_id: a.id });
    expect(error).toBeNull();
    expect((await a.client.from("stripe_events").select("id")).data ?? []).toEqual([]);
    expect((await a.client.from("stripe_events").insert({ id: "evt_forged", type: "x" })).error).not.toBeNull();
  });

  it("an event id is stored once (idempotence key)", async () => {
    const admin = adminClient();
    expect((await admin.from("stripe_events").insert({ id: "evt_once", type: "invoice.payment_failed" })).error).toBeNull();
    expect((await admin.from("stripe_events").insert({ id: "evt_once", type: "invoice.payment_failed" })).error?.code).toBe("23505");
    await admin.from("stripe_events").delete().eq("id", "evt_once");
  });

  it("the subscription and the user's events go with the account", async () => {
    await subscribe(a, { status: "active" });
    await adminClient().from("stripe_events").insert({ id: "evt_gone", type: "x", user_id: a.id });
    await deleteTestUser(a);
    const subs = await adminClient().from("subscriptions").select("user_id").eq("user_id", a.id);
    const events = await adminClient().from("stripe_events").select("id").eq("id", "evt_gone");
    expect(subs.data).toEqual([]);
    expect(events.data).toEqual([]);
  });
});
