/**
 * When a subscription became paid and when its access ended (issue #160, US-17; SPEC D37): kept by a
 * trigger from the Stripe event time the webhook writes. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let u: TestUser;

beforeAll(async () => {
  u = await createTestUser("sub-dates", { plan: "free" });
});
afterAll(async () => {
  await deleteTestUser(u);
});

async function write(status: string, at: string) {
  const { error } = await adminClient()
    .from("subscriptions")
    .upsert({ user_id: u.id, stripe_customer_id: "cus_Dates1", stripe_subscription_id: "sub_Dates1", status, last_event_at: at });
  if (error) throw new Error(error.message);
  const { data } = await adminClient().from("subscriptions").select("paying_since, ended_at").eq("user_id", u.id).single();
  return { payingSince: data!.paying_since ? new Date(data!.paying_since).toISOString() : null, endedAt: data!.ended_at ? new Date(data!.ended_at).toISOString() : null };
}

describe("subscriptions_track_dates", () => {
  it("dates the switch from trial to paid, not the trial, nor a recovered payment", async () => {
    expect(await write("trialing", "2027-01-01T10:00:00.000Z")).toEqual({ payingSince: null, endedAt: null });
    expect(await write("active", "2027-01-15T10:00:00.000Z")).toEqual({ payingSince: "2027-01-15T10:00:00.000Z", endedAt: null });
    await write("past_due", "2027-02-15T10:00:00.000Z");
    expect(await write("active", "2027-02-17T10:00:00.000Z")).toEqual({ payingSince: "2027-01-15T10:00:00.000Z", endedAt: null });
  });

  it("dates the end of access, then clears both for a new subscription", async () => {
    expect(await write("canceled", "2027-03-15T10:00:00.000Z")).toEqual({ payingSince: "2027-01-15T10:00:00.000Z", endedAt: "2027-03-15T10:00:00.000Z" });
    expect(await write("trialing", "2027-05-01T10:00:00.000Z")).toEqual({ payingSince: null, endedAt: null });
  });
});
