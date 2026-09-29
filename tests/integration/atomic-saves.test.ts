/**
 * All-or-nothing saves (tech-debt 2): a failure part-way through a save writes nothing.
 * Fake data, throwaway users. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { BudgetSettings, MonthlyActualDraft } from "@/lib/domain/types";
import { anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  movingGoal: 400000,
  movingDeadlineMonth: "2027-06",
  movingAlreadySaved: 0,
  emergencyTarget: 400000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;
let loanId: string;
let goalId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("atomic-a"), createTestUser("atomic-b")]);
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, []);
  loanId = (
    await repo.createLoan({
      name: "Prêt",
      type: null,
      principal: 500000,
      principalPaidThroughMonth: null,
      apr: 0.05,
      monthlyPayment: 20000,
      contractEndMonth: null,
      penaltyPct: null,
      penaltyCapMonths: null,
      kind: "loan",
      creditLimit: null,
    })
  ).id;
  goalId = (await repo.createGoal({ name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 0 }, 2)).id;
});
afterAll(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

describe("saveActual", () => {
  const draft: MonthlyActualDraft = {
    month: "2027-02",
    income: 290000,
    expenses: 172500,
    movingSavings: 94355,
    emergencySavings: 80000,
    freeSavings: 1234,
    loanBalances: [],
    goalBalances: [],
    frozen: { plannedDebt: 480000, plannedSavings: 174355, plannedIncome: 290000, plannedExpenses: 172500, planStartMonth: "2027-01" },
  };

  it("saves the month and its balances together; re-saving without frozen values keeps them", async () => {
    await repo.saveActual({ ...draft, loanBalances: [{ loanId, balance: 480012 }], goalBalances: [{ goalId, balance: 5000 }] });
    await repo.saveActual({ ...draft, freeSavings: 999, frozen: null, loanBalances: [{ loanId, balance: 470000 }], goalBalances: [{ goalId, balance: 6000 }] });
    const [saved] = (await repo.load()).actuals;
    expect(saved).toMatchObject({
      month: "2027-02",
      freeSavings: 999,
      loanBalances: [{ loanId, balance: 470000 }],
      goalBalances: [{ goalId, balance: 6000 }],
      frozen: draft.frozen,
    });
  });

  it("writes nothing when a balance after valid ones is refused (existing month)", async () => {
    const before = (await repo.load()).actuals;
    await expect(
      repo.saveActual({
        ...draft,
        freeSavings: 1,
        loanBalances: [{ loanId, balance: 1 }],
        goalBalances: [
          { goalId, balance: 1 },
          { goalId: UNKNOWN_ID, balance: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "23503" });
    expect((await repo.load()).actuals).toEqual(before);
  });

  it("writes nothing when a balance is invalid (new month)", async () => {
    await expect(
      repo.saveActual({ ...draft, month: "2027-03", loanBalances: [{ loanId, balance: 100 }, { loanId: UNKNOWN_ID, balance: 100 }] }),
    ).rejects.toMatchObject({ code: "23503" });
    expect((await repo.load()).actuals.map((x) => x.month)).toEqual(["2027-02"]);
  });

  it("stays under RLS: another user can neither see nor reference the first user's rows", async () => {
    const other = new SupabaseFinanceRepository(b.client);
    await expect(other.saveActual({ ...draft, loanBalances: [{ loanId, balance: 1 }] })).rejects.toMatchObject({ code: "23503" });
    expect((await other.load()).actuals).toEqual([]);
    expect((await repo.load()).actuals[0]?.freeSavings).toBe(999);
  });

  it("is not callable without a session", async () => {
    const { error } = await anonClient().rpc("save_actual", { p_actual: {}, p_loan_balances: [], p_goal_balances: [] });
    expect(error?.code).toBe("42501");
  });
});
