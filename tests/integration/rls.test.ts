/**
 * Row Level Security: user B must not read, update, delete or forge user A's rows,
 * on every table (docs/SPEC.md, brief "Quality gates"). Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const TABLES = [
  "profiles",
  "budget_settings",
  "budget_lines",
  "loans",
  "monthly_actuals",
  "monthly_actual_loan_balances",
] as const;
type Table = (typeof TABLES)[number];

/** Primary-key column of each table. */
const KEY: Record<Table, string> = {
  profiles: "user_id",
  budget_settings: "user_id",
  budget_lines: "id",
  loans: "id",
  monthly_actuals: "id",
  monthly_actual_loan_balances: "id",
};

/** A harmless column to try to overwrite. */
const PATCH: Record<Table, Record<string, unknown>> = {
  profiles: { display_name: "pirate" },
  budget_settings: { moving_goal: 1 },
  budget_lines: { amount: 1 },
  loans: { principal: 1 },
  monthly_actuals: { free_savings: 1 },
  monthly_actual_loan_balances: { balance: 1 },
};

let a: TestUser;
let b: TestUser;
const aRow = {} as Record<Table, string>;
let aLoanId: string;
let aActualId: string;

/** Throws on error. Writes without `.select()` legitimately return null data. */
type Row = { id: string } & Record<string, unknown>;

/** Throws on error. The caller states the row shape (the test client is untyped). */
async function must<T = Row>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

beforeAll(async () => {
  a = await createTestUser("a");
  b = await createTestUser("b");

  // User A's data, created through A's own session (RLS applies to these writes too).
  await must(
    a.client.from("budget_settings").insert({ start_month: "2027-01", moving_deadline_month: "2027-06", moving_goal: 4000 }),
  );
  const line = await must(a.client.from("budget_lines").select("id").limit(1).single());
  const loan = await must(
    a.client.from("loans").insert({ name: "Prêt test", principal: 1000, apr: 0.05, monthly_payment: 100 }).select("id").single(),
  );
  const actual = await must(
    a.client
      .from("monthly_actuals")
      .insert({ month: "2027-01", moving_savings: 100, emergency_savings: 0, free_savings: 0 })
      .select("id")
      .single(),
  );
  const balance = await must(
    a.client
      .from("monthly_actual_loan_balances")
      .insert({ monthly_actual_id: actual.id, loan_id: loan.id, balance: 900 })
      .select("id")
      .single(),
  );
  aLoanId = loan.id;
  aActualId = actual.id;
  Object.assign(aRow, {
    profiles: a.id,
    budget_settings: a.id,
    budget_lines: line.id,
    loans: loan.id,
    monthly_actuals: actual.id,
    monthly_actual_loan_balances: balance.id,
  });
});

afterAll(async () => {
  await deleteTestUser(a);
  await deleteTestUser(b);
});

describe("signup trigger", () => {
  it("creates the profile and the 15 default budget lines", async () => {
    const lines = await must<Row[]>(a.client.from("budget_lines").select("category"));
    expect(lines).toHaveLength(15);
    const profile = await must<Row[]>(a.client.from("profiles").select("user_id").eq("user_id", a.id));
    expect(profile).toHaveLength(1);
  });
});

describe.each(TABLES)("RLS on %s", (table) => {
  const key = () => KEY[table];
  const id = () => aRow[table];

  it("owner can read their row (positive control)", async () => {
    const rows = await must<Row[]>(a.client.from(table).select(key()).eq(key(), id()));
    expect(rows).toHaveLength(1);
  });

  it("another user cannot read it", async () => {
    const rows = await must<Row[]>(b.client.from(table).select(key()).eq(key(), id()));
    expect(rows).toHaveLength(0);
    const all = await must<{ user_id: string }[]>(b.client.from(table).select("user_id"));
    expect(all.every((r) => r.user_id === b.id)).toBe(true);
  });

  it("another user cannot update it", async () => {
    const updated = await b.client.from(table).update(PATCH[table]).eq(key(), id()).select();
    // RLS filters silently: no error, zero rows (an error would mean something else blocked it).
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(0);
    const [column, value] = Object.entries(PATCH[table])[0]!;
    const current = await must(adminClient().from(table).select(column).eq(key(), id()).single());
    expect(current[column]).not.toBe(value);
  });

  it("another user cannot delete it", async () => {
    const deleted = await b.client.from(table).delete().eq(key(), id()).select();
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(0);
    const still = await must<Row[]>(adminClient().from(table).select(key()).eq(key(), id()));
    expect(still).toHaveLength(1);
  });

  it("anonymous visitors get nothing", async () => {
    const res = await anonClient().from(table).select(key()).eq(key(), id());
    expect(res.data ?? []).toHaveLength(0);
  });
});

describe("forged writes", () => {
  it("cannot insert rows owned by another user, on any table", async () => {
    const forged: Record<Table, Record<string, unknown>> = {
      profiles: { user_id: a.id },
      budget_settings: { user_id: a.id, start_month: "2027-01", moving_deadline_month: "2027-06" },
      budget_lines: { user_id: a.id, category: "income", label: "forged", amount: 1 },
      loans: { user_id: a.id, principal: 1, apr: 0.1, monthly_payment: 1 },
      monthly_actuals: { user_id: a.id, month: "2027-02", moving_savings: 0, emergency_savings: 0, free_savings: 0 },
      monthly_actual_loan_balances: { user_id: a.id, monthly_actual_id: aActualId, loan_id: aLoanId, balance: 1 },
    };
    for (const table of TABLES) {
      const { error } = await b.client.from(table).insert(forged[table]);
      expect(error, `insert into ${table}`).not.toBeNull();
    }
  });

  it("cannot move one's own row to another user", async () => {
    const own = await must(
      b.client.from("loans").insert({ principal: 10, apr: 0, monthly_payment: 5 }).select("id").single(),
    );
    const { error } = await b.client.from("loans").update({ user_id: a.id }).eq("id", own.id);
    expect(error).not.toBeNull();
  });

  it("cannot attach a balance to another user's check-in or loan", async () => {
    const ownActual = await must(
      b.client
        .from("monthly_actuals")
        .insert({ month: "2027-01", moving_savings: 0, emergency_savings: 0, free_savings: 0 })
        .select("id")
        .single(),
    );
    const onForeignLoan = await b.client
      .from("monthly_actual_loan_balances")
      .insert({ monthly_actual_id: ownActual.id, loan_id: aLoanId, balance: 1 });
    expect(onForeignLoan.error).not.toBeNull();
    const ownLoan = await must(
      b.client.from("loans").insert({ principal: 10, apr: 0, monthly_payment: 5 }).select("id").single(),
    );
    const onForeignActual = await b.client
      .from("monthly_actual_loan_balances")
      .insert({ monthly_actual_id: aActualId, loan_id: ownLoan.id, balance: 1 });
    expect(onForeignActual.error).not.toBeNull();
  });
});

describe("constraints", () => {
  it("allows at most 6 active loans per user", async () => {
    const c = await createTestUser("limit");
    try {
      for (let i = 0; i < 6; i++) {
        await must(c.client.from("loans").insert({ principal: 100, apr: 0.05, monthly_payment: 10, position: i }));
      }
      const seventh = await c.client.from("loans").insert({ principal: 100, apr: 0.05, monthly_payment: 10 });
      expect(seventh.error?.message).toMatch(/Maximum 6 active loans/);
    } finally {
      await deleteTestUser(c);
    }
  });

  it("rejects invalid amounts, rates and months", async () => {
    const bad = [
      b.client.from("loans").insert({ principal: -1, apr: 0.05, monthly_payment: 10 }),
      b.client.from("loans").insert({ principal: 100, apr: 1.5, monthly_payment: 10 }),
      b.client.from("budget_lines").insert({ category: "income", label: "x", amount: -5 }),
      b.client.from("monthly_actuals").insert({ month: "2027-13", moving_savings: 0, emergency_savings: 0, free_savings: 0 }),
    ];
    for (const res of await Promise.all(bad)) expect(res.error).not.toBeNull();
  });
});
