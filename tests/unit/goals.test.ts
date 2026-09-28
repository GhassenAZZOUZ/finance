/**
 * Several savings goals (issue #10, SPEC D23), with hand-checkable numbers. Budget: income −
 * expenses = the month's available amount; no loans; early repayment 0 %.
 */
import { describe, expect, it } from "vitest";
import { validateGoal } from "@/lib/domain/validation";
import { type BudgetParams, type GoalInput, type PlanMonth, simulatePlan } from "@/lib/engine";

function budget(available: number, goals: GoalInput[] | undefined, extra: Partial<BudgetParams> = {}): BudgetParams {
  return {
    income: 100_000 + available,
    fixedCosts: 100_000,
    variableExpenses: 0,
    startMonth: "2027-01",
    movingGoal: 0,
    movingDeadlineMonth: "2027-01",
    movingAlreadySaved: 0,
    emergencyTarget: 1_000_000,
    emergencyExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 0,
    ...(goals ? { goals } : {}),
    ...extra,
  };
}

const goal = (id: string, target: number, deadlineMonth = "2030-12", alreadySaved = 0): GoalInput => ({
  id,
  name: id,
  target,
  deadlineMonth,
  alreadySaved,
});
const m = (months: PlanMonth[], index: number) => months[index - 1] as PlanMonth;

describe("goals allocation", () => {
  it("fills goals by priority, then the emergency fund (AC-03, AC-04)", () => {
    // Goal 1 needs 1 000 €, goal 2 needs 2 000 €, 1 500 € available: 1 000 + 500, nothing left.
    const { months } = simulatePlan({ budget: budget(150_000, [goal("a", 100_000), goal("b", 200_000)]), loans: [] });
    expect(m(months, 1).goals).toEqual([
      { toGoal: 100_000, cumulative: 100_000 },
      { toGoal: 50_000, cumulative: 50_000 },
    ]);
    expect(m(months, 1)).toMatchObject({ toMoving: 150_000, movingCumulative: 150_000, toEmergency: 0 });
    // Month 2: goal 1 full, goal 2 gets its last 1 500 €, the emergency fund nothing.
    expect(m(months, 2).goals.map((g) => g.toGoal)).toEqual([0, 150_000]);
    expect(m(months, 2).toEmergency).toBe(0);
    // Month 3: all goals reached, everything to the emergency fund.
    expect(m(months, 3)).toMatchObject({ toMoving: 0, toEmergency: 150_000, movingReached: true });
  });

  it("skips a goal already reached (AC-05)", () => {
    const { months } = simulatePlan({ budget: budget(50_000, [goal("a", 100_000, "2030-12", 100_000), goal("b", 200_000)]), loans: [] });
    expect(m(months, 1).goals.map((g) => g.toGoal)).toEqual([0, 50_000]);
  });

  it("stops funding a goal after its deadline; the next one takes the money", () => {
    // Goal a: 2 months to its deadline (Jan, Feb 2027), 500 €/month available.
    const { months, kpis } = simulatePlan({
      budget: budget(50_000, [goal("a", 300_000, "2027-02"), goal("b", 200_000)]),
      loans: [],
    });
    expect(m(months, 2).goals[0]).toEqual({ toGoal: 50_000, cumulative: 100_000 });
    expect(m(months, 3).goals.map((g) => g.toGoal)).toEqual([0, 50_000]);
    expect(kpis.goals[0]).toMatchObject({ id: "a", amountAtDeadline: 100_000, met: false, reachedMonth: null, monthlyNeeded: 150_000 });
    expect(kpis.goals[1]).toMatchObject({ id: "b", met: true, reachedMonth: "2027-06" });
    expect(m(months, 300).movingReached).toBe(false);
  });

  it("a deadline this month still receives this month's savings", () => {
    const { months } = simulatePlan({ budget: budget(50_000, [goal("a", 100_000, "2027-01")]), loans: [] });
    expect(m(months, 1).goals[0]?.toGoal).toBe(50_000);
    expect(m(months, 2).goals[0]?.toGoal).toBe(0);
  });

  it("with no goals, savings go straight to the emergency fund", () => {
    const { months, kpis } = simulatePlan({ budget: budget(50_000, []), loans: [] });
    expect(m(months, 1)).toMatchObject({ toMoving: 0, movingCumulative: 0, toEmergency: 50_000, goals: [] });
    expect(kpis.goals).toEqual([]);
  });

  it("the primary goal (id « moving ») drives the moving KPIs, wherever its priority", () => {
    const { kpis } = simulatePlan({
      budget: budget(50_000, [goal("car", 100_000), { ...goal("moving", 60_000, "2027-06"), name: "Déménagement" }]),
      loans: [],
    });
    expect(kpis.movingGoal).toBe(60_000);
    expect(kpis.movingReachedMonth).toBe(kpis.goals[1]?.reachedMonth);
  });

  it("a single goal list equals the spreadsheet's moving fund (AC-01)", () => {
    const moving = { movingGoal: 400_000, movingDeadlineMonth: "2027-06", movingAlreadySaved: 50_000 };
    const without = simulatePlan({ budget: budget(120_000, undefined, moving), loans: [] });
    const withGoals = simulatePlan({
      budget: budget(120_000, [{ id: "moving", name: "Déménagement", target: 400_000, deadlineMonth: "2027-06", alreadySaved: 50_000 }], moving),
      loans: [],
    });
    expect(withGoals).toEqual(without);
  });
});

describe("validateGoal (AC-06)", () => {
  const form = (over: Partial<Record<"name" | "target" | "deadlineMonth" | "alreadySaved", string>> = {}) => ({
    name: "Voiture",
    target: "8 000",
    deadlineMonth: "2028-06",
    alreadySaved: "500",
    ...over,
  });
  const opts = { currentMonth: "2026-09" };

  it("accepts a valid goal (AC-02 values)", () => {
    expect(validateGoal(form(), opts)).toEqual({
      ok: true,
      value: { name: "Voiture", target: 800_000, deadlineMonth: "2028-06", alreadySaved: 50_000 },
    });
  });

  it.each([
    [{ name: "  " }, "name", "Nom requis"],
    [{ target: "0" }, "target", "L’objectif doit être supérieur à 0"],
    [{ target: "-5" }, "target", "Le montant ne peut pas être négatif"],
    [{ deadlineMonth: "2026-08" }, "deadlineMonth", "La date limite est déjà passée"],
    [{ deadlineMonth: "juin" }, "deadlineMonth", "Mois invalide (AAAA-MM)"],
    [{ alreadySaved: "-1" }, "alreadySaved", "Le montant ne peut pas être négatif"],
  ])("rejects %j", (over, field, message) => {
    expect(validateGoal(form(over), opts)).toEqual({ ok: false, errors: { [field]: message } });
  });

  it("the current month is a valid deadline; the primary goal may keep a past one", () => {
    expect(validateGoal(form({ deadlineMonth: "2026-09" }), opts).ok).toBe(true);
    expect(validateGoal(form({ deadlineMonth: "2025-01" }), { ...opts, primary: true }).ok).toBe(true);
  });
});
