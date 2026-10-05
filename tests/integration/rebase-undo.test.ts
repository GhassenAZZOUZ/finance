/**
 * Undo a re-base (issue #100): `rebase_plan_with_undo` keeps a copy of what it changes, `undo_rebase`
 * puts it back in one transaction, and the copy expires as soon as a check-in is saved or the budget
 * edited. Fake data, throwaway users. Requires `supabase start`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { RebaseChanges } from "@/lib/data/repository";
import type { BudgetSettings, FinanceSnapshot, LoanDraft, MonthlyActualDraft } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 400000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};
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
const frozen = { plannedDebt: 470000, plannedSavings: 12000, plannedIncome: 290000, plannedExpenses: 170000, planStartMonth: "2027-01" };

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;
let kept: string;
let repaid: string;
let unused: string;
let goal: string;

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

/** The re-base from February, with the emergency fund corrected by hand from 200 € to 320 €. */
const changes = (): RebaseChanges => ({
  fromMonth: "2027-02",
  corrections: [{ label: "Fonds d’urgence", read: 20000, used: 32000 }],
  freezes: [
    { month: "2027-01", frozen },
    { month: "2027-02", frozen },
  ],
  settings: { ...settings, startMonth: "2027-03", emergencyExisting: 32000, freeSavingsExisting: 3000 },
  loanUpdates: [{ id: kept, draft: { ...LOAN, principal: 450000, principalPaidThroughMonth: "2027-02" } }],
  // `repaid` has check-ins (archived); `unused` has none (deleted).
  loansToArchive: [repaid, unused],
  goalUpdates: [{ id: goal, draft: { name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 7000 } }],
});

/** What the undo must restore exactly, everything but timestamps. */
const shape = (s: FinanceSnapshot) => ({
  settings: s.settings,
  loans: s.loans.map(({ id, name, principal, principalPaidThroughMonth, archivedAt }) => ({ id, name, principal, principalPaidThroughMonth, archivedAt })),
  archived: s.archivedLoans.map((l) => l.id),
  goals: s.goals.map(({ id, alreadySaved }) => ({ id, alreadySaved })),
  frozen: s.actuals.map((x) => ({ month: x.month, frozen: x.frozen, corrections: x.rebaseCorrections ?? null })),
});

beforeEach(async () => {
  [a, b] = await Promise.all([createTestUser("undo-a"), createTestUser("undo-b")]);
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, []);
  kept = (await repo.createLoan(LOAN)).id;
  repaid = (await repo.createLoan({ ...LOAN, name: "Soldé", principal: 1000 })).id;
  unused = (await repo.createLoan({ ...LOAN, name: "Jamais saisi", principal: 2000 })).id;
  goal = (await repo.createGoal({ name: "Voyage", target: 300000, deadlineMonth: "2027-12", alreadySaved: 0 }, 2)).id;
  await repo.saveActual(actual("2027-01"));
  await repo.saveActual({ ...actual("2027-02"), loanBalances: [{ loanId: kept, balance: 450000 }, { loanId: repaid, balance: 0 }] });
});
afterEach(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

describe("rebase_plan_with_undo", () => {
  it("re-bases, records the hand corrections on the check-in, and offers the undo", async () => {
    await repo.rebasePlan(changes());
    const after = await repo.load();
    expect(after.settings).toMatchObject({ startMonth: "2027-03", emergencyExisting: 32000 });
    expect(after.rebaseUndo).toEqual({ fromMonth: "2027-02", newStartMonth: "2027-03" });
    expect(after.actuals.find((x) => x.month === "2027-02")?.rebaseCorrections).toEqual([{ label: "Fonds d’urgence", read: 20000, used: 32000 }]);
    expect(after.actuals.find((x) => x.month === "2027-01")?.rebaseCorrections).toBeUndefined();
    expect(after.loans.map((l) => l.id)).toEqual([kept]);
    expect(after.archivedLoans.map((l) => l.id)).toEqual([repaid]);
  });
});

describe("undo_rebase", () => {
  it("AC-03 — puts back settings, loans (updated, archived, deleted), goals and frozen check-ins exactly", async () => {
    const before = shape(await repo.load());
    await repo.rebasePlan(changes());
    await repo.undoRebase();
    const after = await repo.load();
    expect(shape(after)).toEqual(before);
    expect(after.rebaseUndo).toBeNull();
    // Only the latest re-base can be undone, once.
    await expect(repo.undoRebase()).rejects.toMatchObject({ code: "P0002" });
  });

  it("AC-04 — expires when a check-in is saved", async () => {
    await repo.rebasePlan(changes());
    await repo.saveActual({ ...actual("2027-03"), loanBalances: [{ loanId: kept, balance: 430000 }] });
    expect((await repo.load()).rebaseUndo).toBeNull();
    await expect(repo.undoRebase()).rejects.toMatchObject({ code: "P0002" });
  });

  it("AC-04 — expires when the budget, a loan or a goal is edited", async () => {
    for (const edit of [
      () => repo.saveBudget({ ...settings, startMonth: "2027-03", emergencyExisting: 32000, freeSavingsExisting: 3000 }, []),
      () => repo.updateLoan(kept, { ...LOAN, principal: 449000 }),
      () => repo.updateGoal(goal, { name: "Voyage", target: 310000, deadlineMonth: "2027-12", alreadySaved: 7000 }),
    ]) {
      await repo.rebasePlan({ ...changes(), loansToArchive: [] });
      expect((await repo.load()).rebaseUndo).not.toBeNull();
      await edit();
      expect((await repo.load()).rebaseUndo).toBeNull();
    }
  });

  it("is per user: another user neither sees nor undoes it", async () => {
    await repo.rebasePlan(changes());
    const other = new SupabaseFinanceRepository(b.client);
    expect((await b.client.from("plan_rebase_undo").select("user_id")).data).toEqual([]);
    await b.client.from("plan_rebase_undo").delete().eq("user_id", a.id);
    await expect(other.undoRebase()).rejects.toMatchObject({ code: "P0002" });
    expect((await repo.load()).rebaseUndo).not.toBeNull();
  });

  it("is not callable without a session", async () => {
    const { anonClient } = await import("./supabase-env");
    const { error } = await anonClient().rpc("undo_rebase");
    expect(error).not.toBeNull();
  });
});
