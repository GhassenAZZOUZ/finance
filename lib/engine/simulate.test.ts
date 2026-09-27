/**
 * Hand-checkable edge cases (SPEC §4–§8). The exhaustive comparison with the spreadsheet
 * lives in tests/unit/engine.golden.test.ts.
 */
import { describe, expect, it } from "vitest";
import { compareActual, latestActual, statusFor } from "./actuals";
import { computePriorities, isLineActive, simulatePlan } from "./simulate";
import type { BudgetParams, LoanInput, PlanMonth } from "./types";

function budget(overrides: Partial<BudgetParams> = {}): BudgetParams {
  return {
    income: 200_000,
    fixedCosts: 100_000,
    variableExpenses: 50_000,
    startMonth: "2027-01",
    movingGoal: 0,
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: 0,
    emergencyTarget: 0,
    emergencyExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 0.5,
    ...overrides,
  };
}

function loan(id: string, principal: number, apr: number, monthlyPayment: number): LoanInput {
  return { id, name: null, principal, apr, monthlyPayment };
}

const at = (months: PlanMonth[], index: number) => months[index - 1] as PlanMonth;

describe("simulatePlan", () => {
  it("is deterministic and does not mutate its input", () => {
    const input = { budget: budget(), loans: [loan("a", 100_000, 0.05, 20_000)] };
    const frozen = structuredClone(input);
    expect(simulatePlan(input)).toEqual(simulatePlan(input));
    expect(input).toEqual(frozen);
  });

  it("with no loans: no debt, every early-repayment euro falls back to free savings", () => {
    const { months, kpis } = simulatePlan({ budget: budget(), loans: [] });
    const m1 = at(months, 1);
    expect(m1.available).toBe(50_000);
    expect(m1.toEarlyRepayment).toBe(25_000);
    expect(m1.unusedEarlyRepayment).toBe(25_000);
    expect(m1.toFreeSavings).toBe(50_000);
    expect(kpis.hasDebt).toBe(false);
    expect(kpis.debtFreeMonth).toBeNull();
    expect(kpis.debtRatio).toBe(0);
  });

  it("pays a loan off mid-month (capped last payment) and frees its payment the month after", () => {
    // 100.00 € at 12 %: m1 interest 1.00, pays 60.00 → 41.00; m2 interest 0.41, pays 41.41 → 0.
    const { months, loans } = simulatePlan({
      budget: budget({ earlyRepaymentPct: 0 }),
      loans: [loan("a", 10_000, 0.12, 6_000)],
    });
    expect(at(months, 1).loans[0]).toMatchObject({ interest: 100, paymentPaid: 6_000, endBalance: 4_100 });
    expect(at(months, 2).loans[0]).toMatchObject({ interest: 41, paymentPaid: 4_141, balanceAfterPayment: 0 });
    expect(at(months, 3).loans[0]?.paymentPaid).toBe(0);
    expect(at(months, 3).available - at(months, 1).available).toBe(6_000);
    expect(loans[0]?.payoffMonthWithoutPlan).toBe("2027-02");
  });

  it("keeps a negative month out of the savings (nothing allocated, nothing withdrawn)", () => {
    const { months, kpis } = simulatePlan({
      budget: budget({ income: 140_000, emergencyTarget: 100_000, emergencyExisting: 30_000 }),
      loans: [],
    });
    const m1 = at(months, 1);
    expect(m1.available).toBe(-10_000);
    expect(m1.negativeBudget).toBe(true);
    expect([m1.toMoving, m1.toEmergency, m1.remainder, m1.toFreeSavings]).toEqual([0, 0, 0, 0]);
    expect(m1.emergencyCumulative).toBe(30_000);
    expect(kpis.negativeBudgetMonths).toBe(300);
  });

  it("fills the moving fund only up to the deadline month (inclusive), then the emergency fund", () => {
    const { months, kpis } = simulatePlan({
      budget: budget({ movingGoal: 400_000, movingDeadlineMonth: "2027-02", emergencyTarget: 100_000 }),
      loans: [],
    });
    expect(at(months, 2).toMoving).toBe(50_000);
    expect(at(months, 3).toMoving).toBe(0);
    expect(at(months, 3).toEmergency).toBe(50_000);
    expect(kpis.movingAmountAtDeadline).toBe(100_000);
    expect(kpis.movingMonthlyNeeded).toBe(200_000);
    expect(kpis.movingGoalMet).toBe(false);
  });

  it("handles a deadline already passed", () => {
    const { months, kpis } = simulatePlan({
      budget: budget({ movingGoal: 100_000, movingAlreadySaved: 20_000, movingDeadlineMonth: "2026-10" }),
      loans: [],
    });
    expect(months.every((m) => m.toMoving === 0)).toBe(true);
    expect(kpis.deadlineBeforeStart).toBe(true);
    expect(kpis.movingMonthlyNeeded).toBe(0);
    expect(kpis.movingAmountAtDeadline).toBe(20_000);
  });

  it("lets the balance grow when the payment is below the interest", () => {
    const { months, loans } = simulatePlan({
      budget: budget({ earlyRepaymentPct: 0 }),
      loans: [loan("a", 185_000, 0.189, 2_000)],
    });
    expect(at(months, 2).loans[0]!.startBalance).toBeGreaterThan(185_000);
    expect(loans[0]?.paymentBelowInterest).toBe(true);
    expect(loans[0]?.payoffMonthWithoutPlan).toBeNull();
  });

  it("repays nothing early when every loan is at or below the threshold", () => {
    const loans = [loan("a", 100_000, 0.02, 10_000), loan("b", 50_000, 0, 5_000)];
    expect(computePriorities(loans, 0.02)).toEqual([null, null]);
    const { months, kpis } = simulatePlan({ budget: budget(), loans });
    expect(months.every((m) => m.totalEarlyRepayment === 0)).toBe(true);
    expect(at(months, 1).unusedEarlyRepayment).toBe(at(months, 1).toEarlyRepayment);
    expect(kpis.interestSaved).toBe(0);
  });

  it("with earlyRepaymentPct = 0 %, everything left goes to free savings", () => {
    const { months } = simulatePlan({ budget: budget({ earlyRepaymentPct: 0 }), loans: [loan("a", 100_000, 0.1, 10_000)] });
    expect(months.every((m) => m.toEarlyRepayment === 0 && m.toFreeSavings === m.remainder)).toBe(true);
  });

  it("with earlyRepaymentPct = 100 %, free savings only get what the loans cannot absorb", () => {
    const { months } = simulatePlan({ budget: budget({ earlyRepaymentPct: 1 }), loans: [loan("a", 100_000, 0.1, 10_000)] });
    expect(months.every((m) => m.toFreeSavings === m.unusedEarlyRepayment)).toBe(true);
    expect(at(months, 1).totalEarlyRepayment).toBe(40_000);
  });

  it("pours early repayment by priority and overflows to the next loan (avalanche)", () => {
    const loans = [loan("low", 100_000, 0.05, 10_000), loan("high", 20_000, 0.15, 5_000)];
    const { months, loans: summary } = simulatePlan({ budget: budget({ earlyRepaymentPct: 1 }), loans });
    expect(summary.map((l) => l.priority)).toEqual([2, 1]);
    // m1: available 350.00; "high" after payment = 152.50 → cleared; 197.50 overflows to "low".
    const m1 = at(months, 1);
    expect(m1.loans[1]).toMatchObject({ earlyRepayment: 15_250, endBalance: 0 });
    expect(m1.loans[0]?.earlyRepayment).toBe(35_000 - 15_250);
  });

  it("breaks APR ties by entry order", () => {
    const loans = [loan("a", 1_000, 0.08, 100), loan("b", 1_000, 0.12, 100), loan("c", 1_000, 0.08, 100)];
    expect(computePriorities(loans, 0.02)).toEqual([2, 1, 3]);
  });

  it("names unnamed loans by position and flags high-rate loans", () => {
    const { loans } = simulatePlan({
      budget: budget(),
      loans: [{ ...loan("a", 1_000, 0.21, 100), name: "  " }, { ...loan("b", 1_000, 0.05, 100), name: "Auto" }],
    });
    expect(loans.map((l) => [l.displayName, l.advice])).toEqual([
      ["Crédit 1", "highRate"],
      ["Auto", "worthIt"],
    ]);
  });
});

describe("actuals", () => {
  const input = { budget: budget({ emergencyTarget: 1_000_000 }), loans: [loan("a", 100_000, 0.05, 10_000)] };
  const plan = simulatePlan(input);

  it("uses inclusive ±10 € boundaries for the status", () => {
    expect(statusFor(1_000, -1_000)).toBe("onTrack");
    expect(statusFor(1_001, -1_001)).toBe("late");
    expect(statusFor(1_001, 0)).toBe("mixed");
    expect(statusFor(0, -1_001)).toBe("mixed");
  });

  it("compares a month with the plan, including information-only income/expense gaps", () => {
    const m1 = at(plan.months, 1);
    const c = compareActual(
      {
        month: "2027-01",
        income: 210_000,
        expenses: null,
        movingSavings: 0,
        emergencySavings: m1.emergencyCumulative,
        freeSavings: 0,
        loanBalances: [m1.remainingDebt + 500],
      },
      plan,
      input.budget,
    );
    expect(c).toMatchObject({ planIndex: 1, debtGap: 500, savingsGap: 0, status: "onTrack", incomeGap: 10_000, expensesGap: null });
  });

  it("returns no plan comparison for a month outside the horizon", () => {
    const c = compareActual(
      { month: "2026-12", income: null, expenses: null, movingSavings: 0, emergencySavings: 0, freeSavings: 0, loanBalances: [] },
      plan,
      input.budget,
    );
    expect(c).toMatchObject({ planIndex: null, plannedDebt: null, status: null });
  });

  it("picks the most recent month as the latest entry, whatever the order", () => {
    expect(latestActual([{ month: "2027-03" }, { month: "2027-05" }, { month: "2027-04" }])?.month).toBe("2027-05");
    expect(latestActual([])).toBeNull();
  });
});

describe("residual under 1 € (SPEC D13)", () => {
  it("adds the residual to the payment instead of adding a month", () => {
    // 795,00 € at 1,5 %, 80,00 €/month: the 10th payment would leave 0,48 € → it becomes 80,48 €.
    const { months, loans } = simulatePlan({ budget: budget({ earlyRepaymentPct: 0 }), loans: [loan("a", 79_500, 0.015, 8_000)] });
    expect(at(months, 10).loans[0]).toMatchObject({ paymentPaid: 8_048, endBalance: 0 });
    expect(at(months, 11).loans[0]?.paymentPaid).toBe(0);
    expect(loans[0]).toMatchObject({ payoffMonthWithPlan: "2027-10", payoffMonthWithoutPlan: "2027-10" });
  });

  it("keeps a residual of 1 € or more for the next month", () => {
    // 100,00 € at 0 %, 99,00 €/month: 1,00 € remains, paid the month after.
    const { months } = simulatePlan({ budget: budget({ earlyRepaymentPct: 0 }), loans: [loan("a", 10_000, 0, 9_900)] });
    expect(at(months, 1).loans[0]).toMatchObject({ paymentPaid: 9_900, endBalance: 100 });
    expect(at(months, 2).loans[0]).toMatchObject({ paymentPaid: 100, endBalance: 0 });
  });
});

describe("one-off budget exceptions (SPEC D14)", () => {
  const base = budget({ emergencyTarget: 10_000_000, earlyRepaymentPct: 0 });

  it("changes only the months concerned; several exceptions in a month add up", () => {
    const { months, kpis } = simulatePlan({
      budget: {
        ...base,
        exceptions: [
          { month: "2027-03", kind: "income", amount: 100_000 },
          { month: "2027-03", kind: "expense", amount: 30_000 },
          { month: "2027-03", kind: "expense", amount: 10_000 },
          { month: "2027-05", kind: "expense", amount: 80_000 },
        ],
      },
      loans: [],
    });
    expect(at(months, 2)).toMatchObject({ income: 200_000, expenses: 150_000, extraIncome: 0, extraExpenses: 0, available: 50_000 });
    expect(at(months, 3)).toMatchObject({ income: 300_000, expenses: 190_000, extraIncome: 100_000, extraExpenses: 40_000, available: 110_000 });
    // A big expense can make a single month negative.
    expect(at(months, 5)).toMatchObject({ expenses: 230_000, available: -30_000, negativeBudget: true });
    expect(kpis.negativeBudgetMonths).toBe(1);
    // KPIs describe the regular month.
    expect(kpis).toMatchObject({ monthlyIncome: 200_000, monthlyExpenses: 150_000, margin: 50_000 });
  });

  it("ignores exceptions outside the plan and changes nothing without exceptions", () => {
    const without = simulatePlan({ budget: base, loans: [] });
    const outside = simulatePlan({ budget: { ...base, exceptions: [{ month: "2026-12", kind: "expense", amount: 99_999 }] }, loans: [] });
    expect(outside).toEqual(without);
  });

  it("compares a check-in with that month's budget, exceptions included", () => {
    const input = { budget: { ...base, exceptions: [{ month: "2027-01", kind: "income" as const, amount: 50_000 }] }, loans: [] };
    const plan = simulatePlan(input);
    const c = compareActual(
      { month: "2027-01", income: 250_000, expenses: 150_000, movingSavings: 0, emergencySavings: 0, freeSavings: 0, loanBalances: [] },
      plan,
      input.budget,
    );
    expect(c).toMatchObject({ incomeGap: 0, expensesGap: 0 });
  });
});

describe("budget lines with a period (SPEC D15)", () => {
  const base = budget({ emergencyTarget: 10_000_000, earlyRepaymentPct: 0 });
  const lines = [
    { category: "income" as const, amount: 200_000, startMonth: null, endMonth: null },
    { category: "fixed" as const, amount: 85_000, startMonth: null, endMonth: "2027-06" },
    { category: "fixed" as const, amount: 110_000, startMonth: "2027-07", endMonth: null },
    { category: "variable" as const, amount: 50_000, startMonth: null, endMonth: null },
  ];

  it("uses, each month, only the lines active that month (bounds inclusive)", () => {
    const { months } = simulatePlan({ budget: { ...base, lines }, loans: [] });
    expect(at(months, 6)).toMatchObject({ month: "2027-06", income: 200_000, expenses: 135_000, available: 65_000 });
    expect(at(months, 7)).toMatchObject({ month: "2027-07", income: 200_000, expenses: 160_000, available: 40_000 });
  });

  it("adds one-off exceptions on top of the dated lines", () => {
    const { months } = simulatePlan({
      budget: { ...base, lines, exceptions: [{ month: "2027-07", kind: "expense", amount: 10_000 }] },
      loans: [],
    });
    expect(at(months, 7)).toMatchObject({ expenses: 170_000, extraExpenses: 10_000 });
  });

  it("keeps the KPIs on the reference-month sums given by the caller", () => {
    const { kpis } = simulatePlan({ budget: { ...base, fixedCosts: 110_000, lines }, loans: [] });
    expect(kpis).toMatchObject({ monthlyIncome: 200_000, monthlyExpenses: 160_000, margin: 40_000 });
  });

  it("gives the same plan as constant sums when no line has a period", () => {
    const undated = lines.filter((l) => l.startMonth === null && l.endMonth === null);
    const withLines = simulatePlan({ budget: { ...base, fixedCosts: 0, lines: undated }, loans: [] });
    const constant = simulatePlan({ budget: { ...base, fixedCosts: 0 }, loans: [] });
    expect(withLines.months).toEqual(constant.months);
  });

  it("isLineActive handles open and closed bounds", () => {
    expect(isLineActive({ startMonth: null, endMonth: null }, "2030-01")).toBe(true);
    expect(isLineActive({ startMonth: "2027-07", endMonth: null }, "2027-06")).toBe(false);
    expect(isLineActive({ startMonth: "2027-07", endMonth: "2027-07" }, "2027-07")).toBe(true);
    expect(isLineActive({ startMonth: null, endMonth: "2027-06" }, "2027-07")).toBe(false);
  });
});
