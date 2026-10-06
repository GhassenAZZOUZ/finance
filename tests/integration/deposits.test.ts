/**
 * Savings deposits (issue #73, SPEC D33) against the local database: saved with the check-in in one
 * transaction, balances not stored but computed after loading, a goal's deposits keep its name once
 * the goal is deleted, check-ins with typed balances unchanged. Fake data. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { SavingsDeposit } from "@/lib/domain/deposits";
import { withPlan } from "@/lib/domain/plan";
import type { BudgetSettings, MonthlyActualDraft } from "@/lib/domain/types";
import { adminClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 0,
  emergencyExisting: 50000,
  freeSavingsExisting: 20000,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0,
};

let a: TestUser;
let repo: SupabaseFinanceRepository;
let goalId: string;

beforeAll(async () => {
  a = await createTestUser("deposits");
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, [
    { category: "income", label: "Salaire", amount: 300000, position: 0, startMonth: null, endMonth: null },
    { category: "fixed", label: "Loyer", amount: 270000, position: 0, startMonth: null, endMonth: null },
  ]);
  goalId = (await repo.createGoal({ name: "Voyage", target: 5000000, deadlineMonth: "2030-12", alreadySaved: 100000 }, 1)).id;
});
afterAll(() => deleteTestUser(a));

const draft = (month: string, deposits: SavingsDeposit[]): MonthlyActualDraft => ({
  month,
  income: null,
  expenses: null,
  lines: [],
  deposits,
  emergencySavings: 0,
  freeSavings: 0,
  loanBalances: [],
  goalBalances: [],
  frozen: null,
});
const deps = (goal: number, emergency: number, free: number): SavingsDeposit[] => [
  { pot: "goal", goalId, goalName: "Voyage", planned: 30000, amount: goal },
  { pot: "emergency", goalId: null, goalName: null, planned: 0, amount: emergency },
  { pot: "free", goalId: null, goalName: null, planned: 0, amount: free },
];

describe("savings deposits", () => {
  it("saves the deposits with the check-in, stores no balance, and computes them after loading", async () => {
    await repo.saveActual(draft("2027-01", deps(25000, 1000, -5000)));
    await repo.saveActual(draft("2027-03", deps(32000, 0, 0)));
    const raw = await repo.load();
    expect(raw.actuals[0]!.deposits).toEqual(deps(25000, 1000, -5000));
    const { data } = await adminClient().from("monthly_actuals").select("emergency_savings, free_savings").eq("user_id", a.id);
    expect(data!.every((r) => r.emergency_savings === null && r.free_savings === null)).toBe(true);

    // February not entered: the plan's 300,00 € is counted (AC-04).
    const { snapshot } = withPlan(raw, "2027-06");
    expect(snapshot.actuals.map((x) => [x.month, x.goalBalances[0]?.balance, x.emergencySavings, x.freeSavings])).toEqual([
      ["2027-01", 125000, 51000, 15000],
      ["2027-03", 187000, 51000, 15000],
    ]);
  });

  it("re-saving a month replaces its deposits", async () => {
    await repo.saveActual(draft("2027-01", deps(20000, 0, 0)));
    const { snapshot } = withPlan(await repo.load(), "2027-06");
    expect(snapshot.actuals[0]!.deposits).toEqual(deps(20000, 0, 0));
    expect(snapshot.actuals[1]!.goalBalances[0]!.balance).toBe(182000);
  });

  it("keeps a deleted goal's deposits with its name", async () => {
    const other = await repo.createGoal({ name: "Moto", target: 100000, deadlineMonth: "2030-12", alreadySaved: 0 }, 2);
    await repo.saveActual(draft("2027-04", [...deps(30000, 0, 0), { pot: "goal", goalId: other.id, goalName: "Moto", planned: 0, amount: 1000 }]));
    await repo.deleteGoal(other.id);
    const april = (await repo.load()).actuals.find((x) => x.month === "2027-04")!;
    expect(april.deposits!.at(-1)).toEqual({ pot: "goal", goalId: null, goalName: "Moto", planned: 0, amount: 1000 });
  });

  it("refuses a goal deposit without a name", async () => {
    const { error } = await a.client.rpc("save_actual", {
      p_actual: { month: "2027-05" },
      p_loan_balances: [],
      p_goal_balances: [],
      p_lines: [],
      p_deposits: [{ pot: "goal", goal_id: goalId, goal_name: null, planned: 0, amount: 1 }],
      p_statements: [],
    });
    expect(error).not.toBeNull();
    expect((await repo.load()).actuals.some((x) => x.month === "2027-05")).toBe(false);
  });
});
