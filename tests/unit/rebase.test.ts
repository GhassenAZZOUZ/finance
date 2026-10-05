/** "Recaler le plan" (SPEC D16, issue #5): what a re-base changes, computed from the saved data. */
import { describe, expect, it } from "vitest";
import { primaryGoal } from "../components/helpers";
import { computePlan } from "@/lib/domain/plan";
import { applyRebaseCorrections, frozenFor, planRebase, rebaseFields } from "@/lib/domain/rebase";
import { latestActual } from "@/lib/engine";
import type { FinanceSnapshot, Loan, MonthlyActual } from "@/lib/domain/types";

const loan = (id: string, principal: number): Loan => ({
  id, name: id, type: null, principal, principalPaidThroughMonth: null, apr: 0.05, monthlyPayment: 10_000,
  contractEndMonth: "2029-01", penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null, position: 0, archivedAt: null,
});
const actual = (month: string, balances: [string, number][], extra: Partial<MonthlyActual> = {}): MonthlyActual => ({
  id: month, month, income: null, expenses: null, emergencySavings: 40_000, freeSavings: 5_000,
  loanBalances: balances.map(([loanId, balance]) => ({ loanId, balance })), goalBalances: [{ goalId: "goal-primary", balance: 30_000 }], lines: [],
  frozen: null, ...extra,
});
const snapshot = (actuals: MonthlyActual[]): FinanceSnapshot => ({
  settings: {
    startMonth: "2027-01",
    emergencyTarget: 300_000, emergencyExisting: 0, freeSavingsExisting: 0, riskFreeRate: 0.02, earlyRepaymentPct: 0.5,
  },
  lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null }],
  exceptions: [],
  loans: [loan("car", 500_000), loan("debt", 20_000)],
  archivedLoans: [], goals: [primaryGoal({ target: 400_000, deadlineMonth: "2027-12" })], reminderEnabled: true, incomePayments: [],
  actuals,
});

describe("planRebase", () => {
  it("restarts the month after the latest check-in from its real balances", () => {
    const snap = snapshot([actual("2027-02", [["car", 480_000], ["debt", 10_000]]), actual("2027-03", [["car", 470_000], ["debt", 0]])]);
    const r = planRebase(snap, computePlan(snap, "2027-03")!)!;
    expect(r).toMatchObject({ fromMonth: "2027-03", newStartMonth: "2027-04", loansToArchive: ["debt"] });
    expect(r.settings).toMatchObject({ startMonth: "2027-04", emergencyExisting: 40_000, freeSavingsExisting: 5_000 });
    // The primary goal restarts from its check-in balance, like any goal (SPEC D23).
    expect(r.goalUpdates).toEqual([
      { id: "goal-primary", draft: { name: "Déménagement", target: 400_000, deadlineMonth: "2027-12", alreadySaved: 30_000 } },
    ]);
    expect(r.loanUpdates).toEqual([
      { id: "car", draft: expect.objectContaining({ principal: 470_000, principalPaidThroughMonth: "2027-03", contractEndMonth: "2029-01" }) },
    ]);
  });

  it("freezes every check-in not frozen yet with the current plan, and only those", () => {
    const already = { plannedDebt: 1, plannedSavings: 2, plannedIncome: 3, plannedExpenses: 4, planStartMonth: "2026-01" };
    const snap = snapshot([actual("2027-01", [["car", 490_000]], { frozen: already }), actual("2027-02", [["car", 480_000]])]);
    const plan = computePlan(snap, "2027-02")!;
    const r = planRebase(snap, plan)!;
    expect(r.freezes.map((f) => f.month)).toEqual(["2027-02"]);
    expect(r.freezes[0]!.frozen).toMatchObject({ planStartMonth: "2027-01", plannedDebt: plan.result.months[1]!.remainingDebt });
    expect(frozenFor("2027-01", plan, snap.actuals[0])).toBe(already);
  });

  it("does nothing without a check-in or when the latest one is before the plan start", () => {
    expect(planRebase(snapshot([]), computePlan(snapshot([]), "2027-01")!)).toBeNull();
    const early = snapshot([actual("2026-11", [])]);
    expect(planRebase(early, computePlan(early, "2027-01")!)).toBeNull();
  });
});

describe("#61 AC-08 — an early check-in for next month", () => {
  it("is the latest actual on the dashboard, and the re-base starts the month after it", () => {
    // Today is in March; April's check-in was saved early (its first income was paid in March).
    const snap = snapshot([actual("2027-02", [["car", 480_000], ["debt", 10_000]]), actual("2027-04", [["car", 460_000], ["debt", 0]])]);
    const plan = computePlan(snap, "2027-03")!;
    expect(latestActual(plan.comparisons)?.month).toBe("2027-04");
    expect(planRebase(snap, plan)).toMatchObject({ fromMonth: "2027-04", newStartMonth: "2027-05" });
  });
});

describe("#100 — starting values corrected by hand", () => {
  const snap = snapshot([actual("2027-03", [["car", 470_000], ["debt", 0]])]);
  const rebase = () => planRebase(snap, computePlan(snap, "2027-03")!)!;
  const label = (id: string) => (id === "car" ? "Auto" : "Dette");

  it("lists the editable values with what the check-in read", () => {
    expect(rebaseFields(rebase(), snap.loans, label)).toEqual([
      { key: "goal:goal-primary", label: "Épargne Déménagement", read: 30_000 },
      { key: "emergency", label: "Fonds d’urgence", read: 40_000 },
      { key: "free", label: "Épargne libre", read: 5_000 },
      { key: "loan:car", label: "Auto", read: 470_000 },
      { key: "loan:debt", label: "Dette", read: 0 },
    ]);
  });

  it("AC-01 — uses the corrected values and lists only the corrections", () => {
    const r = applyRebaseCorrections(rebase(), snap.loans, { emergency: 32_000, free: 5_000, "goal:goal-primary": 31_000 }, label);
    expect(r.settings).toMatchObject({ emergencyExisting: 32_000, freeSavingsExisting: 5_000 });
    expect(r.goalUpdates[0]!.draft.alreadySaved).toBe(31_000);
    expect(r.corrections).toEqual([
      { label: "Épargne Déménagement", read: 30_000, used: 31_000 },
      { label: "Fonds d’urgence", read: 40_000, used: 32_000 },
    ]);
  });

  it("nothing corrected: the same re-base, no correction", () => {
    const r = applyRebaseCorrections(rebase(), snap.loans, {}, label);
    expect(r).toEqual({ ...rebase(), corrections: [] });
  });

  it("a loan corrected to 0 is archived; a repaid one corrected above 0 is updated instead", () => {
    const r = applyRebaseCorrections(rebase(), snap.loans, { "loan:car": 0, "loan:debt": 1_500 }, label);
    expect(r.loansToArchive).toEqual(["car"]);
    expect(r.loanUpdates).toEqual([{ id: "debt", draft: expect.objectContaining({ principal: 1_500, principalPaidThroughMonth: "2027-03" }) }]);
    expect(r.corrections).toEqual([
      { label: "Auto", read: 470_000, used: 0 },
      { label: "Dette", read: 0, used: 1_500 },
    ]);
  });
});
