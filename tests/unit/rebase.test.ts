/** "Recaler le plan" (SPEC D16, issue #5): what a re-base changes, computed from the saved data. */
import { describe, expect, it } from "vitest";
import { computePlan } from "@/lib/domain/plan";
import { frozenFor, planRebase } from "@/lib/domain/rebase";
import type { FinanceSnapshot, Loan, MonthlyActual } from "@/lib/domain/types";

const loan = (id: string, principal: number): Loan => ({
  id, name: id, type: null, principal, principalPaidThroughMonth: null, apr: 0.05, monthlyPayment: 10_000,
  contractEndMonth: "2029-01", penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null, position: 0, archivedAt: null,
});
const actual = (month: string, balances: [string, number][], extra: Partial<MonthlyActual> = {}): MonthlyActual => ({
  id: month, month, income: null, expenses: null, movingSavings: 30_000, emergencySavings: 40_000, freeSavings: 5_000,
  loanBalances: balances.map(([loanId, balance]) => ({ loanId, balance })), goalBalances: [], frozen: null, ...extra,
});
const snapshot = (actuals: MonthlyActual[]): FinanceSnapshot => ({
  settings: {
    startMonth: "2027-01", movingGoal: 400_000, movingDeadlineMonth: "2027-12", movingAlreadySaved: 0,
    emergencyTarget: 300_000, emergencyExisting: 0, freeSavingsExisting: 0, riskFreeRate: 0.02, earlyRepaymentPct: 0.5,
  },
  lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null }],
  exceptions: [],
  loans: [loan("car", 500_000), loan("debt", 20_000)],
  archivedLoans: [], goals: [], reminderEnabled: true,
  actuals,
});

describe("planRebase", () => {
  it("restarts the month after the latest check-in from its real balances", () => {
    const snap = snapshot([actual("2027-02", [["car", 480_000], ["debt", 10_000]]), actual("2027-03", [["car", 470_000], ["debt", 0]])]);
    const r = planRebase(snap, computePlan(snap, "2027-03")!)!;
    expect(r).toMatchObject({ fromMonth: "2027-03", newStartMonth: "2027-04", loansToArchive: ["debt"] });
    expect(r.settings).toMatchObject({ startMonth: "2027-04", movingAlreadySaved: 30_000, emergencyExisting: 40_000, freeSavingsExisting: 5_000 });
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
