/** Savings interest (issue #35, SPEC D28): accrued monthly, credited on 31 December; fund surplus → free savings. */
import { describe, expect, it } from "vitest";
import { type BudgetParams, type GoalInput, type PlanResult, simulatePlan } from "@/lib/engine";

/** Income = expenses: nothing is allocated, balances only move with the interest. */
function budget(overrides: Partial<BudgetParams> = {}): BudgetParams {
  return {
    income: 200_000,
    fixedCosts: 150_000,
    variableExpenses: 50_000,
    startMonth: "2027-01",
    movingGoal: 0,
    movingDeadlineMonth: "2027-01",
    movingAlreadySaved: 0,
    emergencyTarget: 0,
    emergencyExisting: 0,
    freeSavingsExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 0,
    ...overrides,
  };
}
const goal = (id: string, target: number, alreadySaved: number, rate?: number): GoalInput => ({
  id,
  name: id,
  target,
  deadlineMonth: "2030-12",
  alreadySaved,
  ...(rate === undefined ? {} : { rate }),
});
const at = (r: PlanResult, month: string) => r.months.find((m) => m.month === month)!;

describe("AC-01 — no rate set = results unchanged", () => {
  it("gives the same plan with rates 0 as without them", () => {
    const b = budget({ income: 300_000, emergencyTarget: 300_000, freeSavingsExisting: 50_000 });
    const without = simulatePlan({ budget: b, loans: [] });
    const zero = simulatePlan({ budget: { ...b, emergencyRate: 0, freeSavingsRate: 0, movingRate: 0 }, loans: [] });
    expect(zero).toEqual(without);
    expect(without.kpis.savingsInterest).toBe(0);
  });
});

describe("AC-02 — free savings interest is credited in December", () => {
  it("accrues 24,00 € a month and credits 288,00 € on 31 December", () => {
    const r = simulatePlan({ budget: budget({ freeSavingsExisting: 1_200_000, freeSavingsRate: 0.024 }), loans: [] });
    expect(at(r, "2027-01").freeSavingsCumulative).toBe(1_200_000);
    expect(at(r, "2027-11").freeSavingsCumulative).toBe(1_200_000);
    expect(at(r, "2027-12")).toMatchObject({ freeSavingsInterest: 28_800, savingsInterest: 28_800, freeSavingsCumulative: 1_228_800 });
    // The credited interest earns interest from January: 12 288,00 € × 2,4 % / 12 = 24,58 €.
    expect(at(r, "2028-12").freeSavingsInterest).toBe(12 * 2_458);
  });

  it("credits a first year pro rata of the months accrued", () => {
    const r = simulatePlan({ budget: budget({ startMonth: "2027-10", freeSavingsExisting: 1_200_000, freeSavingsRate: 0.024 }), loans: [] });
    expect(at(r, "2027-12").freeSavingsInterest).toBe(3 * 2_400);
  });

  it("credits what is accrued in the last plan month", () => {
    const r = simulatePlan({ budget: budget({ startMonth: "2027-03", freeSavingsExisting: 1_200_000, freeSavingsRate: 0.024 }), loans: [] });
    const last = r.months[299]!;
    expect(last.month).toBe("2052-02");
    expect(last.freeSavingsInterest).toBeGreaterThan(0);
    expect(r.months[298]!.freeSavingsInterest).toBe(0);
  });
});

describe("AC-03 — interest helps a goal reach its target", () => {
  it("credits the goal in December and marks it reached then", () => {
    const r = simulatePlan({ budget: budget({ goals: [goal("car", 1_000_000, 999_000, 0.03)] }), loans: [] });
    expect(at(r, "2027-11").goals[0]).toEqual({ toGoal: 0, interest: 0, cumulative: 999_000 });
    // 9 990,00 € × 3 % / 12 = 24,975 → 24,98 € a month.
    expect(at(r, "2027-12").goals[0]).toEqual({ toGoal: 0, interest: 12 * 2_498, cumulative: 999_000 + 12 * 2_498 });
    expect(r.kpis.goals[0]).toMatchObject({ reachedMonth: "2027-12" });
  });

  it("keeps earning once at target (the money stays in the goal)", () => {
    const r = simulatePlan({ budget: budget({ goals: [goal("car", 100_000, 100_000, 0.03)] }), loans: [] });
    expect(at(r, "2027-12").goals[0]!.interest).toBe(12 * 250);
  });

  it("uses the primary goal's rate when it is the only goal", () => {
    const r = simulatePlan({ budget: budget({ movingGoal: 1_000_000, movingAlreadySaved: 999_000, movingDeadlineMonth: "2030-12", movingRate: 0.03 }), loans: [] });
    expect(at(r, "2027-12").movingCumulative).toBe(999_000 + 12 * 2_498);
  });
});

describe("AC-04 — interest accrues in negative months", () => {
  it("still accrues on the emergency fund when nothing is allocated", () => {
    const r = simulatePlan({
      budget: budget({ income: 100_000, emergencyTarget: 1_000_000, emergencyExisting: 500_000, emergencyRate: 0.024 }),
      loans: [],
    });
    expect(at(r, "2027-06")).toMatchObject({ negativeBudget: true, toEmergency: 0 });
    expect(at(r, "2027-12")).toMatchObject({ emergencyInterest: 12 * 1_000, emergencyCumulative: 512_000 });
  });
});

describe("AC-09 — emergency fund interest above its target goes to free savings", () => {
  it("fills the fund to its target, the rest to free savings", () => {
    const r = simulatePlan({ budget: budget({ emergencyTarget: 500_000, emergencyExisting: 495_000, emergencyRate: 0.024 }), loans: [] });
    // 4 950,00 € × 2,4 % / 12 = 9,90 € a month, 118,80 € in the year: 50,00 € to the fund, 68,80 € to free savings.
    expect(at(r, "2027-12")).toMatchObject({
      emergencyInterest: 5_000,
      emergencyCumulative: 500_000,
      freeSavingsInterest: 6_880,
      freeSavingsCumulative: 6_880,
      savingsInterest: 11_880,
    });
  });

  it("sends all of it to free savings once the fund is above its target", () => {
    const r = simulatePlan({ budget: budget({ emergencyTarget: 100_000, emergencyExisting: 500_000, emergencyRate: 0.024 }), loans: [] });
    expect(at(r, "2027-12")).toMatchObject({ emergencyInterest: 0, emergencyCumulative: 500_000, freeSavingsInterest: 12_000 });
  });
});

describe("AC-06 — savings interest KPIs", () => {
  it("sums the interest over the plan and over its first 12 months", () => {
    const r = simulatePlan({ budget: budget({ freeSavingsExisting: 1_200_000, freeSavingsRate: 0.024 }), loans: [] });
    expect(r.kpis.savingsInterestAt12).toBe(28_800);
    expect(r.kpis.savingsInterest).toBe(r.months.reduce((s, m) => s + m.savingsInterest, 0));
    expect(r.kpis.savingsInterest).toBeGreaterThan(28_800 * 25);
  });
});
