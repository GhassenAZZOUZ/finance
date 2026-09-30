/** Savings deposits (issue #73, SPEC D33): balances computed from the deposits; months not entered count the plan's. */
import { describe, expect, it } from "vitest";
import { type SavingsDeposit, balancesByMonth, monthsNotEntered, plannedDeposits } from "@/lib/domain/deposits";
import { computePlan, withPlan } from "@/lib/domain/plan";
import { planRebase } from "@/lib/domain/rebase";
import type { BudgetLine, FinanceSnapshot, MonthlyActual, SavingsGoal } from "@/lib/domain/types";
import { parseDeposit, validateActual } from "@/lib/domain/validation";
import { makeSettings, makeSnapshot } from "../components/helpers";

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const voyage: SavingsGoal = {
  id: "voyage",
  name: "Voyage",
  target: 5_000_000,
  deadlineMonth: "2030-12",
  alreadySaved: 100_000,
  priority: 1,
  primary: true,
};
/** 3 000 € in, 2 700 € out: the plan puts 300,00 € a month into « Voyage », nothing elsewhere. */
function snapshot(actuals: MonthlyActual[] = []): FinanceSnapshot {
  return makeSnapshot({
    settings: makeSettings({ startMonth: "2027-01", emergencyTarget: 0, emergencyExisting: 50_000, freeSavingsExisting: 20_000 }),
    lines: [line("salary", "income", 300_000), line("rent", "fixed", 270_000)],
    goals: [voyage],
    actuals,
  });
}
const deposits = (goal: number, emergency = 0, free = 0): SavingsDeposit[] => [
  { pot: "goal", goalId: "voyage", goalName: "Voyage", planned: 30_000, amount: goal },
  { pot: "emergency", goalId: null, goalName: null, planned: 0, amount: emergency },
  { pot: "free", goalId: null, goalName: null, planned: 0, amount: free },
];
const checkIn = (month: string, d: SavingsDeposit[], extra: Partial<MonthlyActual> = {}): MonthlyActual => ({
  id: month,
  month,
  income: null,
  expenses: null,
  lines: [],
  deposits: d,
  emergencySavings: 0,
  freeSavings: 0,
  loanBalances: [],
  goalBalances: [],
  frozen: null,
  ...extra,
});
const balancesAt = (snap: FinanceSnapshot, month: string) => {
  const plan = computePlan(snap, "2027-06")!;
  return balancesByMonth(plan.result, snap.settings!, snap.goals, snap.actuals, month).get(month)!;
};

describe("AC-01 — the plan's deposit of each pot", () => {
  it("is the change of the plan's balance that month", () => {
    const snap = snapshot();
    const plan = computePlan(snap, "2027-06")!;
    expect(plannedDeposits(plan.result, snap.settings!, snap.goals, "2027-03")).toEqual({ goals: { voyage: 30_000 }, emergency: 0, free: 0 });
    // Before the plan and after its horizon: nothing.
    expect(plannedDeposits(plan.result, snap.settings!, snap.goals, "2026-12").goals.voyage).toBe(0);
  });
});

describe("AC-02 — balances are computed from the deposits", () => {
  it("adds the deposits to the starting amounts", () => {
    const snap = snapshot([checkIn("2027-01", deposits(30_000, 1_000, 500)), checkIn("2027-02", deposits(25_000))]);
    expect(balancesAt(snap, "2027-02")).toEqual({ goals: { voyage: 155_000 }, emergency: 51_000, free: 20_500 });
  });

  it("gives every reader the computed balances (comparison, goals' progress)", () => {
    const { snapshot: computed, plan } = withPlan(snapshot([checkIn("2027-01", deposits(30_000)), checkIn("2027-02", deposits(25_000))]), "2027-06");
    const feb = computed.actuals.find((a) => a.month === "2027-02")!;
    expect(feb).toMatchObject({ emergencySavings: 50_000, freeSavings: 20_000, goalBalances: [{ goalId: "voyage", balance: 155_000 }] });
    // 5 000 € short on « Voyage » vs the plan's 1 600 €: savings gap −50,00 €.
    expect(plan!.comparisons.find((c) => c.month === "2027-02")!.savingsGap).toBe(-5_000);
  });
});

describe("AC-03 — withdrawals", () => {
  it("parses a negative deposit as a withdrawal", () => {
    expect(parseDeposit("-200")).toEqual({ ok: true, value: -20_000 });
    expect(parseDeposit("−200,50")).toEqual({ ok: true, value: -20_050 });
    expect(parseDeposit("0")).toEqual({ ok: true, value: 0 });
    expect(parseDeposit("")).toEqual({ ok: false, error: "Montant requis" });
    expect(parseDeposit("1,234")).toEqual({ ok: false, error: "2 décimales maximum" });
  });

  it("lowers the pot's balance", () => {
    expect(balancesAt(snapshot([checkIn("2027-03", deposits(30_000, 0, -20_000))]), "2027-03").free).toBe(0);
  });

  it("is saved as a deposit with the plan's deposit next to it", () => {
    const r = validateActual(
      { month: "2027-03", emergencySavings: "0", freeSavings: "-200", loanBalances: [], goalBalances: [{ goalId: "voyage", balance: "300" }] },
      {
        startMonth: "2027-01",
        currentMonth: "2027-03",
        activeLoanIds: [],
        goalIds: ["voyage"],
        deposits: { planned: { goals: { voyage: 30_000 }, emergency: 0, free: 0 }, goalNames: { voyage: "Voyage" } },
      },
    );
    expect(r.ok && r.value.deposits).toEqual([
      { pot: "goal", goalId: "voyage", goalName: "Voyage", planned: 30_000, amount: 30_000 },
      { pot: "emergency", goalId: null, goalName: null, planned: 0, amount: 0 },
      { pot: "free", goalId: null, goalName: null, planned: 0, amount: -20_000 },
    ]);
  });
});

describe("AC-04 — a month not entered counts its planned deposits", () => {
  it("counts the plan's deposit for February, then the actual one once entered", () => {
    const jan = checkIn("2027-01", deposits(25_000));
    const mar = checkIn("2027-03", deposits(32_000));
    const snap = snapshot([jan, mar]);
    expect(balancesAt(snap, "2027-03").goals.voyage).toBe(187_000);
    expect(monthsNotEntered(snap.settings!, snap.actuals, "2027-03")).toEqual(["2027-02"]);
    expect(balancesAt(snapshot([jan, checkIn("2027-02", deposits(10_000)), mar]), "2027-03").goals.voyage).toBe(167_000);
  });
});

describe("AC-05 — the re-base uses the computed balances", () => {
  it("restarts from the balances at the end of the latest check-in", () => {
    const { snapshot: computed, plan } = withPlan(
      snapshot([checkIn("2027-01", deposits(25_000, 2_000)), checkIn("2027-03", deposits(32_000, 0, 1_000))]),
      "2027-06",
    );
    const rebase = planRebase(computed, plan!)!;
    expect(rebase.newStartMonth).toBe("2027-04");
    expect(rebase.settings).toMatchObject({ emergencyExisting: 52_000, freeSavingsExisting: 21_000 });
    expect(rebase.goalUpdates).toContainEqual(expect.objectContaining({ id: "voyage", draft: expect.objectContaining({ alreadySaved: 187_000 }) }));
  });

  it("after a re-base, counts from the new start only", () => {
    const snap = snapshot([checkIn("2027-01", deposits(99_999))]);
    const rebased = { ...snap, settings: { ...snap.settings!, startMonth: "2027-02" } };
    expect(balancesAt(rebased, "2027-02").goals.voyage).toBe(130_000);
  });
});

describe("AC-06 — check-ins with typed balances keep their results", () => {
  it("uses their typed balances as they are, to the cent", () => {
    const typed = checkIn("2027-02", [], { deposits: undefined, emergencySavings: 50_123, freeSavings: 20_045, goalBalances: [{ goalId: "voyage", balance: 160_001 }] });
    const before = computePlan({ ...snapshot([typed]) }, "2027-06")!;
    const { snapshot: computed, plan } = withPlan(snapshot([typed]), "2027-06");
    expect(computed.actuals[0]).toMatchObject({ emergencySavings: 50_123, freeSavings: 20_045, goalBalances: [{ goalId: "voyage", balance: 160_001 }] });
    expect(plan!.comparisons).toEqual(before.comparisons);
    // The next month adds its deposits to them.
    const next = snapshot([typed, checkIn("2027-03", deposits(30_000))]);
    expect(balancesAt(next, "2027-03").goals.voyage).toBe(190_001);
  });
});

describe("goals added or deleted", () => {
  it("ignores the deposits of a deleted goal and starts a new goal from its amount already saved", () => {
    const other: SavingsDeposit = { pot: "goal", goalId: "gone", goalName: "Ancien", planned: 0, amount: 99_900 };
    const snap = snapshot([checkIn("2027-01", [...deposits(30_000), other])]);
    expect(balancesAt(snap, "2027-01")).toEqual({ goals: { voyage: 130_000 }, emergency: 50_000, free: 20_000 });
  });
});
