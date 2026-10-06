/**
 * Free plan limits (issue #139, US-2): enforced by the database, HTTP 402 with the limit key; Pro
 * (Stripe or a grant) never blocked. Fake data, throwaway users. Requires `supabase start`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const users: TestUser[] = [];
const user = async (plan: "pro" | "free") => {
  const u = await createTestUser(`limits-${plan}`, { plan });
  users.push(u);
  return u;
};
afterEach(async () => {
  await Promise.all(users.splice(0).map(deleteTestUser));
});

const loan = (u: TestUser, name: string) =>
  u.client.from("loans").insert({ name, principal: 1000, apr: 0.05, monthly_payment: 100 }).select("id").single<{ id: string }>();
const goal = (u: TestUser, name: string, priority: number) =>
  u.client.from("savings_goals").insert({ name, target: 1000, deadline_month: "2028-06", priority }).select("id").single<{ id: string }>();

describe("Free limits", () => {
  it("1 active loan: the second is refused with HTTP 402 and « loans_limit »", async () => {
    const u = await user("free");
    expect((await loan(u, "Auto")).error).toBeNull();
    const refused = await loan(u, "Travaux");
    expect(refused.status).toBe(402);
    expect(refused.error).toMatchObject({ code: "PT402", message: "loans_limit" });
    const { count } = await u.client.from("loans").select("id", { count: "exact", head: true });
    expect(count).toBe(1);
  });

  it("an archived loan does not count, but making it active again is checked", async () => {
    const u = await user("free");
    const first = (await loan(u, "Ancien")).data!;
    await adminClient().from("loans").update({ archived_at: new Date().toISOString() }).eq("id", first.id);
    expect((await loan(u, "Nouveau")).error).toBeNull();
    const reactivate = await u.client.from("loans").update({ archived_at: null }).eq("id", first.id).select();
    expect(reactivate.error).toMatchObject({ code: "PT402", message: "loans_limit" });
  });

  it("1 savings goal: the second is refused with « goals_limit »", async () => {
    const u = await user("free");
    expect((await goal(u, "Voyage", 1)).error).toBeNull();
    expect((await goal(u, "Voiture", 2)).error).toMatchObject({ code: "PT402", message: "goals_limit" });
  });

  it("the limits live in one table, readable by users, not writable", async () => {
    const u = await user("free");
    const { data } = await u.client.from("plan_limits").select("key, free_value").order("key");
    expect(data).toEqual([
      { key: "goals_limit", free_value: 1 },
      { key: "loans_limit", free_value: 1 },
    ]);
    const write = await u.client.from("plan_limits").update({ free_value: 99 }).eq("key", "loans_limit").select();
    expect(write.error ?? (write.data?.length === 0 ? "filtered" : null)).not.toBeNull();
  });
});

describe("Pro is never blocked", () => {
  it("with a grant (early users)", async () => {
    const u = await user("pro");
    for (const name of ["A", "B", "C"]) expect((await loan(u, name)).error).toBeNull();
    expect((await goal(u, "Voyage", 1)).error).toBeNull();
    expect((await goal(u, "Voiture", 2)).error).toBeNull();
    const { data } = await u.client.from("entitlements").select("is_pro, status, grant_reason").single();
    expect(data).toEqual({ is_pro: true, status: "granted", grant_reason: "gift" });
  });

  it("with a Stripe subscription, past_due during the grace period included", async () => {
    const u = await user("free");
    await adminClient()
      .from("subscriptions")
      .insert({ user_id: u.id, stripe_customer_id: `cus_${u.id.slice(0, 8)}`, status: "past_due", past_due_since: new Date(Date.now() - 86_400_000).toISOString() });
    expect((await loan(u, "A")).error).toBeNull();
    expect((await loan(u, "B")).error).toBeNull();
  });

  it("an expired grant is Free again", async () => {
    const u = await user("free");
    await adminClient().from("pro_grants").insert({ user_id: u.id, reason: "gift", expires_at: new Date(Date.now() - 1000).toISOString() });
    await loan(u, "A");
    expect((await loan(u, "B")).error).toMatchObject({ code: "PT402" });
    const { data } = await u.client.from("entitlements").select("is_pro").single();
    expect(data?.is_pro).toBe(false);
  });
});

describe("security", () => {
  it("a user cannot grant themselves Pro", async () => {
    const u = await user("free");
    expect((await u.client.from("pro_grants").insert({ user_id: u.id, reason: "gift" })).error).not.toBeNull();
    expect((await u.client.rpc("has_pro", { p_user: u.id })).error).not.toBeNull();
    const other = await user("pro");
    expect((await u.client.from("pro_grants").select("user_id").eq("user_id", other.id)).data).toEqual([]);
  });
});
