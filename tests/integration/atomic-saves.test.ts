/**
 * All-or-nothing saves (tech-debt 2): a failure part-way through a save writes nothing.
 * Fake data, throwaway users. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { RebaseChanges } from "@/lib/data/repository";
import type { BudgetSettings, FrozenPlan, LoanDraft, MonthlyActualDraft } from "@/lib/domain/types";
import { anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 400000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const LOAN: LoanDraft = {
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
};

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;
let loanId: string;
let goalId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("atomic-a"), createTestUser("atomic-b")]);
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, []);
  loanId = (await repo.createLoan(LOAN)).id;
  goalId = (await repo.createGoal({ name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 0 }, 2)).id;
});
afterAll(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

describe("saveActual", () => {
  const draft: MonthlyActualDraft = {
    month: "2027-02",
    income: 290000,
    expenses: 172500,
    emergencySavings: 80000,
    freeSavings: 1234,
    loanBalances: [],
    goalBalances: [],
    lines: [],
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
    const { error } = await anonClient().rpc("save_actual", { p_actual: {}, p_loan_balances: [], p_goal_balances: [], p_lines: [], p_deposits: [], p_statements: [] });
    expect(error?.code).toBe("42501");
  });
});

describe("rebasePlan / freezeActuals", () => {
  let user: TestUser;
  let r: SupabaseFinanceRepository;
  let kept: string;
  let repaid: string;
  let goal: string;
  const frozen = (planStartMonth: string): FrozenPlan => ({
    plannedDebt: 900000,
    plannedSavings: 100000,
    plannedIncome: 290000,
    plannedExpenses: 170000,
    planStartMonth,
  });
  const actual = (month: string): MonthlyActualDraft => ({
    month,
    income: null,
    expenses: null,
    emergencySavings: 20000,
    freeSavings: 3000,
    loanBalances: [
      { loanId: kept, balance: 450000 },
      { loanId: repaid, balance: 0 },
    ],
    goalBalances: [{ goalId: goal, balance: 7000 }],
    lines: [],
    frozen: null,
  });

  beforeAll(async () => {
    user = await createTestUser("atomic-rebase");
    r = new SupabaseFinanceRepository(user.client);
    await r.saveBudget(settings, []);
    kept = (await r.createLoan(LOAN)).id;
    repaid = (await r.createLoan({ ...LOAN, name: "Soldé", principal: 1000 })).id;
    goal = (await r.createGoal({ name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 0 }, 2)).id;
    await r.saveActual(actual("2027-01"));
    await r.saveActual(actual("2027-02"));
  });
  afterAll(() => deleteTestUser(user));

  const changes = (): RebaseChanges => ({
    fromMonth: "2027-02",
    corrections: [],
    freezes: [
      { month: "2027-01", frozen: frozen("2027-01") },
      { month: "2027-02", frozen: frozen("2027-01") },
    ],
    settings: { ...settings, startMonth: "2027-03", emergencyExisting: 20000, freeSavingsExisting: 3000 },
    loanUpdates: [{ id: kept, draft: { ...LOAN, principal: 450000, principalPaidThroughMonth: "2027-02" } }],
    loansToArchive: [repaid],
    goalUpdates: [{ id: goal, draft: { name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 7000 } }],
  });

  it("writes nothing when the last update is refused", async () => {
    const before = await r.load();
    const bad = changes();
    bad.goalUpdates.push({ id: UNKNOWN_ID, draft: { name: "Fantôme", target: 1000, deadlineMonth: "2027-12", alreadySaved: 0 } });
    await expect(r.rebasePlan(bad)).rejects.toMatchObject({ code: "P0002" });
    expect(await r.load()).toEqual(before);
  });

  it("writes nothing when an amount is invalid part-way", async () => {
    const before = await r.load();
    const bad = changes();
    bad.loanUpdates[0]!.draft.principal = -100;
    await expect(r.rebasePlan(bad)).rejects.toMatchObject({ code: "23514" });
    expect(await r.load()).toEqual(before);
  });

  it("applies the whole re-base", async () => {
    await r.rebasePlan(changes());
    const snap = await r.load();
    expect(snap.settings).toMatchObject({ startMonth: "2027-03", emergencyExisting: 20000, freeSavingsExisting: 3000 });
    expect(snap.actuals.map((a) => a.frozen)).toEqual([frozen("2027-01"), frozen("2027-01")]);
    expect(snap.loans).toEqual([expect.objectContaining({ id: kept, principal: 450000, principalPaidThroughMonth: "2027-02" })]);
    expect(snap.archivedLoans.map((l) => l.id)).toEqual([repaid]);
    expect(snap.goals.find((g) => g.id === goal)?.alreadySaved).toBe(7000);
  });

  it("freezes several months in one call and never overwrites a frozen month", async () => {
    await r.saveActual({ ...actual("2027-03"), loanBalances: [{ loanId: kept, balance: 440000 }] });
    await r.freezeActuals([
      { month: "2027-02", frozen: frozen("2099-01") },
      { month: "2027-03", frozen: frozen("2027-03") },
    ]);
    expect((await r.load()).actuals.map((a) => a.frozen?.planStartMonth)).toEqual(["2027-01", "2027-01", "2027-03"]);
  });

  it("is not callable without a session", async () => {
    const empty = { p_settings: {}, p_freezes: [], p_loan_updates: [], p_loans_to_archive: [], p_goal_updates: [] };
    expect((await anonClient().rpc("rebase_plan", empty)).error?.code).toBe("42501");
    expect((await anonClient().rpc("freeze_actuals", { p_freezes: [] })).error?.code).toBe("42501");
  });
});

describe("saveBudget", () => {
  let user: TestUser;
  let r: SupabaseFinanceRepository;
  beforeAll(async () => {
    user = await createTestUser("atomic-budget");
    r = new SupabaseFinanceRepository(user.client);
    await r.saveBudget(settings, []);
    await r.saveBudget(settings, [
      { category: "income", label: "Salaire", amount: 280000, position: 0, startMonth: null, endMonth: null },
      { category: "fixed", label: "Loyer", amount: 85000, position: 0, startMonth: null, endMonth: null },
    ]);
  });
  afterAll(() => deleteTestUser(user));

  it("writes nothing when a line after valid changes is refused", async () => {
    const before = await r.load();
    const [salary] = before.lines;
    await expect(
      r.saveBudget({ ...settings, startMonth: "2028-01" }, [
        // Update, then delete (Loyer left out), then a valid insert, then an invalid one.
        { id: salary!.id, category: salary!.category, label: "Salaire net", amount: 1, position: 0, startMonth: null, endMonth: null },
        { category: "variable", label: "Courses", amount: 30000, position: 0, startMonth: null, endMonth: null },
        { category: "variable", label: "Période", amount: 100, position: 1, startMonth: "2028-06", endMonth: "2028-01" },
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await r.load()).toEqual(before);
  });

  it("is not callable without a session", async () => {
    expect((await anonClient().rpc("save_budget", { p_settings: {}, p_lines: [] })).error?.code).toBe("42501");
  });
});
