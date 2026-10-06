import { describe, expect, it } from "vitest";
import {
  buildHistory,
  checkInMonths,
  isDebtGapGood,
  isSavingsGapGood,
  plannedForMonth,
  prefillForm,
} from "@/app/(app)/suivi/logic";
import type { MonthlyActual } from "@/lib/domain/types";
import { type ActualComparison, type PlanInput, simulatePlan } from "@/lib/engine";

const actual = (month: string, extra: Partial<MonthlyActual> = {}): MonthlyActual => ({
  id: month,
  month,
  income: null,
  frozen: null,
  expenses: 123456,
  emergencySavings: 0,
  freeSavings: 5,
  loanBalances: [{ loanId: "a", balance: 250050 }],
  goalBalances: [{ goalId: "p", balance: 10000 }],
  lines: [],
  ...extra,
});

describe("checkInMonths", () => {
  it("lists start → current, newest first, across years", () => {
    expect(checkInMonths("2026-11", "2027-02")).toEqual(["2027-02", "2027-01", "2026-12", "2026-11"]);
  });
  it("has only the current month when the plan starts this month", () => {
    expect(checkInMonths("2027-01", "2027-01")).toEqual(["2027-01"]);
  });
  it("is empty when the plan starts later", () => {
    expect(checkInMonths("2027-03", "2027-01")).toEqual([]);
  });
});

describe("prefillForm", () => {
  it("is empty without an entry, one balance per active loan", () => {
    expect(prefillForm("2027-01", undefined, [{ id: "a" }, { id: "b" }], [{ id: "p" }])).toEqual({
      month: "2027-01",
      lines: [],
      emergencySavings: "",
      freeSavings: "",
      loanBalances: [
        { loanId: "a", balance: "" },
        { loanId: "b", balance: "" },
      ],
      goalBalances: [{ goalId: "p", balance: "" }],
      statements: [],
    });
  });

  it("uses the existing entry; a loan or goal added since stays empty", () => {
    expect(prefillForm("2027-01", actual("2027-01"), [{ id: "a" }, { id: "b" }], [{ id: "p" }, { id: "new" }])).toEqual({
      month: "2027-01",
      lines: [],
      emergencySavings: "0,00",
      freeSavings: "0,05",
      loanBalances: [
        { loanId: "a", balance: "2500,50" },
        { loanId: "b", balance: "" },
      ],
      goalBalances: [
        { goalId: "p", balance: "100,00" },
        { goalId: "new", balance: "" },
      ],
      statements: [],
    });
  });
});

describe("plannedForMonth", () => {
  const input: PlanInput = {
    budget: {
      income: 300000,
      fixedCosts: 100000,
      variableExpenses: 50000,
      startMonth: "2027-01",
      movingGoal: 200000,
      movingDeadlineMonth: "2027-12",
      movingAlreadySaved: 0,
      emergencyTarget: 300000,
      emergencyExisting: 0, freeSavingsExisting: 0,
      riskFreeRate: 0.024,
      earlyRepaymentPct: 0.5,
    },
    loans: [{ id: "a", name: null, principal: 500000, apr: 0.05, monthlyPayment: 20000 }],
  };
  const result = simulatePlan(input);

  it("reads the plan month at index = months since start", () => {
    const m = result.months[2]!;
    // The primary goal is the engine's moving fund.
    expect(plannedForMonth(result, "2027-01", "2027-03", [{ id: "p", primary: true }])).toEqual({
      emergencySavings: m.emergencyCumulative,
      freeSavings: m.freeSavingsCumulative,
      income: m.income,
      expenses: m.expenses,
      loanBalances: [m.loans[0]!.endBalance],
      goalBalances: [m.movingCumulative],
    });
  });

  it("is null before the start or beyond the horizon", () => {
    expect(plannedForMonth(result, "2027-01", "2026-12")).toBeNull();
    expect(plannedForMonth(result, "2027-01", "2052-01")).toBeNull();
  });
});

describe("gap tolerance (inclusive ±10 €)", () => {
  it("debt: good up to +10 €", () => {
    expect(isDebtGapGood(1000)).toBe(true);
    expect(isDebtGapGood(1001)).toBe(false);
    expect(isDebtGapGood(-50000)).toBe(true);
  });
  it("savings: good down to −10 €", () => {
    expect(isSavingsGapGood(-1000)).toBe(true);
    expect(isSavingsGapGood(-1001)).toBe(false);
    expect(isSavingsGapGood(50000)).toBe(true);
  });
});

describe("buildHistory", () => {
  it("sorts newest first and pairs raw entries", () => {
    const comparison = (month: string) => ({ month }) as ActualComparison;
    const entries = buildHistory(
      [comparison("2027-01"), comparison("2027-03"), comparison("2027-02")],
      [actual("2027-01"), actual("2027-02"), actual("2027-03")],
    );
    expect(entries.map((e) => e.comparison.month)).toEqual(["2027-03", "2027-02", "2027-01"]);
    expect(entries.every((e) => e.actual?.month === e.comparison.month)).toBe(true);
  });
});
