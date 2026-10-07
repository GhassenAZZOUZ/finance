/**
 * Back-office database side (issue #156, US-13): admins and the audit log are out of users' reach,
 * the log is append-only with a 12-month purge, the counts expose two numbers only.
 * Fake data, throwaway users. Requires `supabase start`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let a: TestUser;
beforeEach(async () => {
  a = await createTestUser("admin");
});
afterEach(async () => {
  await adminClient().from("admins").delete().eq("user_id", a.id);
  await deleteTestUser(a);
});

describe("admins and audit log (AC-05, AC-08, AC-09)", () => {
  it("a user can neither read nor make themselves admin", async () => {
    expect((await a.client.from("admins").insert({ user_id: a.id })).error).not.toBeNull();
    await adminClient().from("admins").insert({ user_id: a.id });
    const read = await a.client.from("admins").select("user_id");
    expect(read.error ?? read.data?.length === 0).toBeTruthy();
    // Editing their own metadata gives no right: the role is the table.
    await a.client.auth.updateUser({ data: { role: "admin", is_admin: true } });
    const { count } = await adminClient().from("admins").select("user_id", { count: "exact", head: true }).eq("user_id", a.id);
    expect(count).toBe(1);
  });

  it("a user can neither read nor write the audit log, nor call the admin functions", async () => {
    expect((await a.client.from("admin_audit").insert({ admin_id: a.id, action: "admins.add" })).error).not.toBeNull();
    const read = await a.client.from("admin_audit").select("id");
    expect(read.error ?? read.data?.length === 0).toBeTruthy();
    expect((await a.client.rpc("purge_admin_audit")).error).not.toBeNull();
    expect((await a.client.rpc("admin_usage_counts", { p_users: [a.id] })).error).not.toBeNull();
  });

  it("the service role appends to the log but can neither edit nor delete an entry", async () => {
    const db = adminClient();
    const { data, error } = await db.from("admin_audit").insert({ admin_id: a.id, action: "admins.add", target_user: a.id }).select("id").single<{ id: number }>();
    expect(error).toBeNull();
    expect((await db.from("admin_audit").update({ action: "admins.remove" }).eq("id", data!.id)).error).not.toBeNull();
    expect((await db.from("admin_audit").delete().eq("id", data!.id)).error).not.toBeNull();
  });

  it("keeps entries 12 months: the purge removes only the older ones", async () => {
    const db = adminClient();
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    // Two inserts: in a bulk insert a missing key is sent as null (`at` would be null).
    expect((await db.from("admin_audit").insert({ admin_id: a.id, action: "admins.add", at: old })).error).toBeNull();
    expect((await db.from("admin_audit").insert({ admin_id: a.id, action: "admins.remove" })).error).toBeNull();
    const { data: purged } = await db.rpc("purge_admin_audit");
    expect(purged).toBeGreaterThanOrEqual(1);
    const { data } = await db.from("admin_audit").select("action, at").eq("admin_id", a.id);
    expect(data?.map((e) => e.action)).toEqual(["admins.remove"]);
  });
});

describe("admin_usage_counts (count-only exception)", () => {
  it("returns two numbers per account, never an amount nor a name", async () => {
    await a.client.from("loans").insert([
      { name: "Auto", principal: 1000, apr: 0.05, monthly_payment: 100 },
      { name: "Travaux", principal: 2000, apr: 0.04, monthly_payment: 80 },
    ]);
    await a.client.from("savings_goals").insert({ name: "Voyage", target: 1000, deadline_month: "2028-06", priority: 1 });
    const { data, error } = await adminClient().rpc("admin_usage_counts", { p_users: [a.id] });
    expect(error).toBeNull();
    expect(data).toEqual([{ user_id: a.id, loans: 2, goals: 1 }]);
  });
});
