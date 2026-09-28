/**
 * Monthly reminder (issue #6, SPEC D25) against the local database: who is selected, unsubscribe
 * by token, the send log is private. With REMINDER_FN_URL set (the Edge Function running locally,
 * see docs), also sends through the local mail catcher and checks there is no second e-mail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, deleteTestUser, localSupabase, type TestUser } from "./supabase-env";

const MONTH = "2027-03";
let due: TestUser; // plan, no check-in for MONTH → reminded
let done: TestUser; // check-in already entered → not reminded
let off: TestUser; // reminder turned off → not reminded
let noPlan: TestUser; // no budget yet → not reminded

async function plan(user: TestUser) {
  const { error } = await user.client.from("budget_settings").insert({ start_month: "2027-01", moving_deadline_month: "2027-06", moving_goal: 1000 });
  if (error) throw error;
}

async function recipients(): Promise<string[]> {
  const { data, error } = await adminClient().rpc("reminder_recipients", { p_month: MONTH });
  if (error) throw error;
  return (data as { user_id: string }[]).map((r) => r.user_id);
}

beforeAll(async () => {
  [due, done, off, noPlan] = await Promise.all([
    createTestUser("reminder-due"),
    createTestUser("reminder-done"),
    createTestUser("reminder-off"),
    createTestUser("reminder-noplan"),
  ]);
  await Promise.all([plan(due), plan(done), plan(off)]);
  const checkIn = await done.client.from("monthly_actuals").insert({ month: MONTH, moving_savings: 0, emergency_savings: 0, free_savings: 0 });
  if (checkIn.error) throw checkIn.error;
  const disable = await off.client.from("profiles").update({ reminder_enabled: false }).eq("user_id", off.id);
  if (disable.error) throw disable.error;
});
afterAll(async () => {
  await Promise.all([due, done, off, noPlan].map((u) => deleteTestUser(u)));
});

describe("reminder recipients", () => {
  it("selects users with a plan, the reminder on and no check-in that month", async () => {
    const ids = await recipients();
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(done.id);
    expect(ids).not.toContain(off.id);
    expect(ids).not.toContain(noPlan.id);
  });

  it("is not callable by users or visitors", async () => {
    expect((await due.client.rpc("reminder_recipients", { p_month: MONTH })).error).not.toBeNull();
    expect((await anonClient().rpc("reminder_recipients", { p_month: MONTH })).error).not.toBeNull();
  });

  it("skips a user already reminded this month (log), and the log is private", async () => {
    const log = await adminClient().from("reminder_log").insert({ user_id: due.id, month: "2027-04" });
    expect(log.error).toBeNull();
    const { data } = await adminClient().rpc("reminder_recipients", { p_month: "2027-04" });
    expect((data as { user_id: string }[]).map((r) => r.user_id)).not.toContain(due.id);
    const read = await due.client.from("reminder_log").select("*");
    expect(read.data ?? []).toEqual([]);
    expect((await due.client.from("reminder_log").insert({ user_id: due.id, month: "2027-05" })).error).not.toBeNull();
  });
});

describe("unsubscribe link", () => {
  it("turns off only the token owner's reminder; a tampered token changes nothing", async () => {
    const tokenOf = async (u: TestUser) =>
      ((await adminClient().from("profiles").select("reminder_token").eq("user_id", u.id).single()).data as { reminder_token: string })
        .reminder_token;
    const noPlanToken = await tokenOf(noPlan);
    const tampered = await anonClient().rpc("unsubscribe_reminder", { p_token: "00000000-0000-4000-8000-000000000000" });
    expect(tampered.data).toBe(false);
    const ok = await anonClient().rpc("unsubscribe_reminder", { p_token: noPlanToken });
    expect(ok.data).toBe(true);
    const flags = await adminClient().from("profiles").select("user_id, reminder_enabled").in("user_id", [noPlan.id, due.id]);
    expect(Object.fromEntries((flags.data ?? []).map((r) => [r.user_id, r.reminder_enabled]))).toEqual({ [noPlan.id]: false, [due.id]: true });
  });
});

const FN = process.env.REMINDER_FN_URL;
describe.runIf(FN)("Edge Function (local)", () => {
  const call = (body: object) =>
    fetch(FN!, { method: "POST", headers: { "x-reminder-secret": process.env.REMINDER_SECRET ?? "local-test-secret" }, body: JSON.stringify(body) });
  const mails = async (email: string) => {
    const api = new URL(localSupabase().url);
    const res = await fetch(`${api.protocol}//${api.hostname}:${Number(api.port) + 3}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    return ((await res.json()) as { messages: { Subject: string }[] }).messages;
  };

  it("e-mails the due user once, with a link to Suivi, and never twice for the month", async () => {
    const first = await call({ force: true, month: MONTH });
    expect(first.status).toBe(200);
    const inbox = await mails(due.email);
    expect(inbox.map((m) => m.Subject)).toEqual(["Votre suivi de mars 2027 vous attend"]);
    expect(await mails(done.email)).toEqual([]);
    const again = await call({ force: true, month: MONTH });
    expect(((await again.json()) as { sent: number }).sent).toBe(0);
    expect(await mails(due.email)).toHaveLength(1);
  });
});
