import { describe, expect, it } from "vitest";
import { DEFAULT_ROW_COUNT, findMilestones, milestoneState, parseRowCount, planIndexOf } from "@/app/(app)/plan/milestones";
import { type PlanInput, simulatePlan } from "@/lib/engine";

const baseInput: PlanInput = {
  budget: {
    income: 300_000,
    fixedCosts: 150_000,
    variableExpenses: 50_000,
    startMonth: "2027-01",
    movingGoal: 200_000,
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: 0,
    emergencyTarget: 150_000,
    emergencyExisting: 0, freeSavingsExisting: 0,
    riskFreeRate: 0.024,
    earlyRepaymentPct: 0.5,
  },
  loans: [
    { id: "a", name: "Prêt auto", principal: 100_000, apr: 0.05, monthlyPayment: 20_000 },
    { id: "b", name: null, principal: 300_000, apr: 0.12, monthlyPayment: 30_000 },
  ],
};

describe("parseRowCount", () => {
  it.each([
    [undefined, DEFAULT_ROW_COUNT],
    ["18", 18],
    ["60", 60],
    ["300", 300],
    [["300", "24"], 300],
    ["24", DEFAULT_ROW_COUNT],
    ["abc", DEFAULT_ROW_COUNT],
    ["1000", DEFAULT_ROW_COUNT],
  ])("%s → %d", (param, expected) => {
    expect(parseRowCount(param)).toBe(expected);
  });
});

describe("milestoneState", () => {
  it("is strong on the first month, light afterwards, none before or when never reached", () => {
    expect(milestoneState(3, 5)).toBeNull();
    expect(milestoneState(5, 5)).toBe("first");
    expect(milestoneState(6, 5)).toBe("after");
    expect(milestoneState(6, null)).toBeNull();
  });
});

describe("planIndexOf", () => {
  it("maps calendar months to 1-based plan months within the horizon", () => {
    expect(planIndexOf("2027-01", "2027-01", 300)).toBe(1);
    expect(planIndexOf("2028-01", "2027-01", 300)).toBe(13);
    expect(planIndexOf("2026-12", "2027-01", 300)).toBeNull();
    expect(planIndexOf("2052-01", "2027-01", 300)).toBeNull();
  });
});

describe("findMilestones", () => {
  it("matches the first month each engine flag is set", () => {
    const result = simulatePlan(baseInput);
    const m = findMilestones(baseInput, result);
    const first = (flag: "movingReached" | "emergencyReached" | "debtFree") => result.months.find((x) => x[flag])?.index;

    expect(m.movingIndex).toBe(first("movingReached"));
    expect(m.emergencyIndex).toBe(first("emergencyReached"));
    expect(m.debtFreeIndex).toBe(first("debtFree"));
    expect(m.movingIndex).not.toBeNull();
    expect(m.debtFreeIndex).not.toBeNull();
    expect(m.deadlineIndex).toBe(6);
    expect(m.negativeCount).toBe(0);
    expect(m.firstNegativeMonth).toBeNull();
  });

  it("lists each loan on its payoff month, with the default name for unnamed loans", () => {
    const result = simulatePlan(baseInput);
    const m = findMilestones(baseInput, result);
    const names = [...m.loanPayoffs.values()].flat().sort();
    expect(names).toEqual(["Crédit 2", "Prêt auto"]);
    for (const loan of result.loans) {
      const index = planIndexOf(loan.payoffMonthWithPlan!, baseInput.budget.startMonth, result.months.length)!;
      expect(m.loanPayoffs.get(index)).toContain(loan.displayName);
    }
    // The last loan paid off is the debt-free month.
    expect(Math.max(...m.loanPayoffs.keys())).toBe(m.debtFreeIndex);
  });

  it("skips milestones with nothing to reach and reports negative months", () => {
    const input: PlanInput = {
      budget: { ...baseInput.budget, income: 100_000, movingGoal: 0, emergencyTarget: 0, movingDeadlineMonth: "2026-01" },
      loans: [],
    };
    const m = findMilestones(input, simulatePlan(input));
    expect(m.movingIndex).toBeNull();
    expect(m.emergencyIndex).toBeNull();
    expect(m.debtFreeIndex).toBeNull();
    expect(m.deadlineIndex).toBeNull();
    expect(m.loanPayoffs.size).toBe(0);
    expect(m.negativeCount).toBe(300);
    expect(m.firstNegativeMonth).toBe("2027-01");
  });
});
