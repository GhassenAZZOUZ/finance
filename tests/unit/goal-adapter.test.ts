/**
 * Tech-debt 6: the primary goal is stored as a goal like the others, but the engine keeps the
 * spreadsheet's shape. For each case, the plan computed from the new data equals, to the cent, the
 * plan computed from the input the app built before (moving fund in the settings).
 */
import { describe, expect, it } from "vitest";
import { computePlan } from "@/lib/domain/plan";
import type { SavingsGoal } from "@/lib/domain/types";
import { type BudgetParams, type GoalInput, type PlanResult, PRIMARY_GOAL_ID, simulatePlan } from "@/lib/engine";
import { makeLoan, makeSettings, makeSnapshot, primaryGoal } from "../components/helpers";

const LINES = [
  { id: "i", category: "income" as const, label: "Salaire", amount: 320_000, position: 0, startMonth: null, endMonth: null },
  { id: "f", category: "fixed" as const, label: "Loyer", amount: 110_000, position: 0, startMonth: null, endMonth: null },
  { id: "v", category: "variable" as const, label: "Courses", amount: 45_000, position: 0, startMonth: null, endMonth: null },
];
const LOANS = [makeLoan(1, { name: "Auto", apr: 0.06 }), makeLoan(2, { name: "Perso", principal: 250_000, apr: 0.11, monthlyPayment: 12_000 })];
const SETTINGS = makeSettings({ startMonth: "2027-01", emergencyTarget: 500_000, emergencyExisting: 50_000, riskFreeRate: 0.025, earlyRepaymentPct: 0.6 });

/** The engine input the app built before: the moving fund from the settings, extra goals only when some exist. */
function previousInput(fund: { target: number; deadlineMonth: string; alreadySaved: number }, extra: SavingsGoal[], primaryPriority = 1) {
  const budget: BudgetParams = {
    income: 320_000,
    fixedCosts: 110_000,
    variableExpenses: 45_000,
    ...SETTINGS,
    movingGoal: fund.target,
    movingDeadlineMonth: fund.deadlineMonth,
    movingAlreadySaved: fund.alreadySaved,
    exceptions: [],
  };
  if (extra.length > 0) {
    const goals: (GoalInput & { priority: number })[] = [
      { id: PRIMARY_GOAL_ID, name: "Déménagement", ...fund, priority: primaryPriority },
      ...extra.map((g) => ({ id: g.id, name: g.name, target: g.target, deadlineMonth: g.deadlineMonth, alreadySaved: g.alreadySaved, priority: g.priority })),
    ];
    budget.goals = goals
      .sort((a, b) => a.priority - b.priority)
      .map((g) => ({ id: g.id, name: g.name, target: g.target, deadlineMonth: g.deadlineMonth, alreadySaved: g.alreadySaved }));
  }
  return simulatePlan({ budget, loans: computePlan(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: LOANS }))!.input.loans });
}

/** Everything but the goals' display names, which now come from the goals themselves. */
function withoutNames(result: PlanResult) {
  return { ...result, kpis: { ...result.kpis, goals: result.kpis.goals.map((g) => ({ ...g, name: "" })) } };
}

const extra = (id: string, priority: number, target: number, deadlineMonth: string): SavingsGoal => ({
  id,
  name: id,
  target,
  deadlineMonth,
  alreadySaved: 10_000,
  priority,
  primary: false,
});

describe("primary goal adapter (tech-debt 6)", () => {
  it.each([
    ["the moving fund alone", { target: 600_000, deadlineMonth: "2027-10", alreadySaved: 80_000 }, [], 1],
    ["no target yet (0 €)", { target: 0, deadlineMonth: "2027-01", alreadySaved: 0 }, [], 1],
    ["a deadline before the plan start", { target: 300_000, deadlineMonth: "2026-06", alreadySaved: 20_000 }, [], 1],
    ["with extra goals, primary first", { target: 400_000, deadlineMonth: "2027-12", alreadySaved: 0 }, [extra("car", 2, 150_000, "2028-06")], 1],
    [
      "with extra goals, primary in the middle",
      { target: 400_000, deadlineMonth: "2027-12", alreadySaved: 50_000 },
      [extra("car", 1, 150_000, "2027-06"), extra("trip", 3, 200_000, "2029-01")],
      2,
    ],
  ] as const)("same plan as before: %s", (_case, fund, extras, primaryPriority) => {
    const goals = [primaryGoal({ ...fund, priority: primaryPriority }), ...extras];
    const now = computePlan(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: LOANS, goals }), "2027-01")!;
    const before = previousInput(fund, [...extras], primaryPriority);
    expect(withoutNames(now.result)).toEqual(withoutNames(before));
  });

  it("names the goals after the user's goals", () => {
    const plan = computePlan(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: LOANS, goals: [primaryGoal({ name: "Voyage" })] }))!;
    expect(plan.result.kpis.goals.map((g) => g.name)).toEqual(["Voyage"]);
  });

  it("without any goal, the moving fund is empty and neutrally named", () => {
    const plan = computePlan(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: LOANS, goals: [] }))!;
    expect(plan.input.budget).toMatchObject({ movingGoal: 0, movingAlreadySaved: 0, movingDeadlineMonth: "2027-01" });
    expect(plan.result.kpis.goals.map((g) => g.name)).toEqual(["Objectif d’épargne"]);
    expect(plan.result.months.every((m) => m.toMoving === 0)).toBe(true);
  });
});
