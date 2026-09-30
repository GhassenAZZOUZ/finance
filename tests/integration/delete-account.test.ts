/**
 * Account deletion (issue #37, SPEC D26): `delete_my_account()` removes the caller's auth user and,
 * by cascade, every row of theirs, and nothing of anyone else. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, deleteTestUser, localSupabase, type TestUser } from "./supabase-env";

/**
 * Every table of the public schema, all keyed by `user_id`. A new table must be added here, which
 * makes its author check that it cascades from auth.users (the guard test below fails otherwise).
 */
const USER_TABLES = [
  "profiles",
  "budget_settings",
  "budget_lines",
  "budget_exceptions",
  "loans",
  "monthly_actuals",
  "monthly_actual_loan_balances",
  "savings_goals",
  "monthly_actual_goal_balances",
  "reminder_log",
  "income_payments",
] as const;

type Row = { id: string } & Record<string, unknown>;

async function must<T = Row>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** Fills every table for `user` (through their own session, except the service-only reminder log). */
async function seed(user: TestUser): Promise<void> {
  const db = user.client;
  await must(db.from("budget_settings").insert({ start_month: "2027-01", moving_deadline_month: "2027-06", moving_goal: 4000 }));
  await must(db.from("budget_exceptions").insert({ month: "2027-12", kind: "income", label: "Prime", amount: 500 }));
  const loan = await must(db.from("loans").insert({ name: "Prêt test", principal: 1000, apr: 0.05, monthly_payment: 100 }).select("id").single());
  const actual = await must(
    db.from("monthly_actuals").insert({ month: "2027-01", moving_savings: 100, emergency_savings: 0, free_savings: 0 }).select("id").single(),
  );
  await must(db.from("monthly_actual_loan_balances").insert({ monthly_actual_id: actual.id, loan_id: loan.id, balance: 900 }));
  const goal = await must(
    db.from("savings_goals").insert({ name: "Voiture", target: 8000, deadline_month: "2028-06", priority: 2 }).select("id").single(),
  );
  await must(db.from("monthly_actual_goal_balances").insert({ monthly_actual_id: actual.id, goal_id: goal.id, balance: 50 }));
  const line = await must(db.from("budget_lines").select("id").eq("category", "income").limit(1).single());
  await must(db.from("income_payments").insert({ month: "2027-02", budget_line_id: line.id, paid_on: "2027-01-28" }));
  await must(adminClient().from("reminder_log").insert({ user_id: user.id, month: "2027-01" }));
}

async function countRows(table: string, userId: string): Promise<number> {
  const { count, error } = await adminClient().from(table).select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  a = await createTestUser("delete-a");
  b = await createTestUser("delete-b");
  await seed(a);
  await seed(b);
});

afterAll(async () => {
  await deleteTestUser(a).catch(() => {});
  await deleteTestUser(b);
});

describe("delete_my_account", () => {
  it("lists every table of the public schema (a new table must be checked for its cascade)", async () => {
    const env = localSupabase();
    const res = await fetch(`${env.url}/rest/v1/`, { headers: { apikey: env.secretKey, Authorization: `Bearer ${env.secretKey}` } });
    const spec = (await res.json()) as { definitions?: Record<string, unknown> };
    const exposed = Object.keys(spec.definitions ?? {}).sort();
    expect(exposed).toEqual([...USER_TABLES].sort());
  });

  it("is refused without a session", async () => {
    const { error } = await anonClient().rpc("delete_my_account");
    expect(error).not.toBeNull();
  });

  it("removes the caller's auth user and every row of theirs, and nothing of another user", async () => {
    for (const table of USER_TABLES) expect(await countRows(table, a.id), table).toBeGreaterThan(0);

    await must(a.client.rpc("delete_my_account"));

    const { data } = await adminClient().auth.admin.getUserById(a.id);
    expect(data.user).toBeNull();
    for (const table of USER_TABLES) {
      expect(await countRows(table, a.id), table).toBe(0);
      expect(await countRows(table, b.id), table).toBeGreaterThan(0);
    }
  });

  it("lets the same address sign up again as a brand-new user", async () => {
    const { data, error } = await adminClient().auth.admin.createUser({ email: a.email, email_confirm: true });
    expect(error).toBeNull();
    expect(data.user!.id).not.toBe(a.id);
    expect(await countRows("budget_settings", data.user!.id)).toBe(0);
    expect(await countRows("profiles", data.user!.id)).toBe(1);
    await adminClient().auth.admin.deleteUser(data.user!.id);
  });
});
