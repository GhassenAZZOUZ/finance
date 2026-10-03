/**
 * Savings interest in the computed balances (issue #82, SPEC D33 / D28): the planned deposit leaves
 * the interest out, the computed balances add it with the plan's rule, so depositing exactly the
 * plan gives exactly the plan's balances. Invented data only.
 */
import { describe, expect, it } from "vitest";
import { type PotBalances, balancesByMonth, plannedBalances, plannedDeposits } from "@/lib/domain/deposits";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, MonthlyActual, SavingsGoal } from "@/lib/domain/types";
import { type YearMonth, addMonths } from "@/lib/engine";
import { makeLoan, makeSettings, makeSnapshot, primaryGoal } from "../components/helpers";

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const SETTINGS = makeSettings({
  startMonth: "2027-03",
  emergencyTarget: 800_000,
  emergencyExisting: 500_000,
  freeSavingsExisting: 120_000,
  emergencyRate: 0.024,
  freeSavingsRate: 0.03,
  earlyRepaymentPct: 0.5,
});
const GOALS: SavingsGoal[] = [
  primaryGoal({ target: 600_000, deadlineMonth: "2028-06", alreadySaved: 150_000, rate: 0.025 }),
  { id: "car", name: "Voiture", target: 300_000, deadlineMonth: "2029-12", alreadySaved: 20_000, priority: 2, primary: false, rate: 0.018 },
];
const SNAPSHOT = makeSnapshot({
  settings: SETTINGS,
  lines: [line("salary", "income", 420_000), line("rent", "fixed", 120_000), line("food", "variable", 60_000)],
  loans: [makeLoan(1, { apr: 0.06 })],
  goals: GOALS,
});
const PLAN = computePlan(SNAPSHOT, "2027-03")!;
const MONTHS: YearMonth[] = Array.from({ length: 30 }, (_, i) => addMonths(SETTINGS.startMonth, i));

/** A check-in with exactly the plan's deposits. */
function asPlanned(month: YearMonth): MonthlyActual {
  const planned = plannedDeposits(PLAN.result, SETTINGS, GOALS, month);
  return {
    id: month,
    month,
    income: null,
    expenses: null,
    emergencySavings: 0,
    freeSavings: 0,
    loanBalances: [],
    goalBalances: [],
    lines: [],
    deposits: [
      ...GOALS.map((g) => ({ pot: "goal" as const, goalId: g.id, goalName: g.name, planned: planned.goals[g.id]!, amount: planned.goals[g.id]! })),
      { pot: "emergency" as const, goalId: null, goalName: null, planned: planned.emergency, amount: planned.emergency },
      { pot: "free" as const, goalId: null, goalName: null, planned: planned.free, amount: planned.free },
    ],
    frozen: null,
  };
}

const withoutInterest = ({ goals, emergency, free }: PotBalances) => ({ goals, emergency, free });

describe("computed balances earn the plan's interest (#82)", () => {
  it("AC-03 — without any check-in, every balance is the plan's, to the cent", () => {
    const balances = balancesByMonth(PLAN.result, SETTINGS, GOALS, [], MONTHS.at(-1)!);
    for (const month of MONTHS) {
      expect(withoutInterest(balances.get(month)!), month).toEqual(plannedBalances(PLAN.result, SETTINGS, GOALS, month));
    }
  });

  it("AC-03 — depositing exactly the plan every month gives the plan's balances, to the cent", () => {
    const balances = balancesByMonth(PLAN.result, SETTINGS, GOALS, MONTHS.map(asPlanned), MONTHS.at(-1)!);
    for (const month of MONTHS) {
      expect(withoutInterest(balances.get(month)!), month).toEqual(plannedBalances(PLAN.result, SETTINGS, GOALS, month));
    }
    // The plan does credit interest each December: the test would be empty otherwise.
    expect(balances.get("2027-12")!.interest).toBeGreaterThan(0);
    expect(balances.get("2027-11")!.interest).toBe(0);
  });

  it("AC-01 — December's planned deposit leaves the credited interest out", () => {
    const december = PLAN.result.months.find((m) => m.month === "2027-12")!;
    expect(december.emergencyInterest + december.freeSavingsInterest).toBeGreaterThan(0);
    const planned = plannedDeposits(PLAN.result, SETTINGS, GOALS, "2027-12");
    expect(planned.emergency).toBe(december.toEmergency);
    expect(planned.goals["car"]).toBe(december.goals[1]!.toGoal);
  });
});

describe("the interest rule on the actual balances", () => {
  const settings = makeSettings({ startMonth: "2027-01", emergencyTarget: 2_000_000, emergencyExisting: 1_000_000, freeSavingsExisting: 0, emergencyRate: 0.024 });
  const snapshot = makeSnapshot({ settings, lines: [line("salary", "income", 100_000)], goals: [] });
  const plan = computePlan(snapshot, "2027-01")!;
  const zero = (month: YearMonth): MonthlyActual => ({
    ...asPlanned(month),
    deposits: [
      { pot: "emergency", goalId: null, goalName: null, planned: 0, amount: 0 },
      { pot: "free", goalId: null, goalName: null, planned: 0, amount: 0 },
    ],
  });

  it("AC-02 — 10 000 € at 2,4 % with no deposit: 20 € a month, credited in December", () => {
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2027-01", i));
    const balances = balancesByMonth(plan.result, settings, [], months.map(zero), "2027-12");
    expect(balances.get("2027-11")!.emergency).toBe(1_000_000);
    expect(balances.get("2027-12")).toMatchObject({ emergency: 1_024_000, interest: 24_000 });
  });

  it("AC-04 — the emergency fund's interest above its target goes to free savings", () => {
    const near = makeSettings({ ...settings, emergencyTarget: 1_000_500 });
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2027-01", i));
    const balances = balancesByMonth(plan.result, near, [], months.map(zero), "2027-12");
    // 240,00 € accrued: 5,00 € fill the fund up to its target, 235,00 € go to free savings.
    expect(balances.get("2027-12")).toMatchObject({ emergency: 1_000_500, free: 23_500, interest: 24_000 });
  });

  it("a typed check-in (before #73) is the truth: the interest restarts from it", () => {
    const typed: MonthlyActual = { ...zero("2027-06"), deposits: [], emergencySavings: 1_100_000, freeSavings: 0 };
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2027-01", i)).filter((m) => m !== "2027-06");
    const balances = balancesByMonth(plan.result, settings, [], [...months.map(zero), typed], "2027-12");
    expect(balances.get("2027-06")!.emergency).toBe(1_100_000);
    // July to December only: 6 × 22,00 €.
    expect(balances.get("2027-12")).toMatchObject({ emergency: 1_113_200, interest: 13_200 });
  });

  it("no rate anywhere: no interest at all", () => {
    const flat = makeSettings({ ...settings, emergencyRate: 0 });
    const months = Array.from({ length: 12 }, (_, i) => addMonths("2027-01", i));
    const balances = balancesByMonth(plan.result, flat, [], months.map(zero), "2027-12");
    expect(balances.get("2027-12")).toMatchObject({ emergency: 1_000_000, interest: 0 });
  });
});
