/** Rows of a monthly check-in (issue #72): which rows, their budget of the month, totals. Invented data only. */
import { describe, expect, it } from "vitest";
import { OTHER_EXPENSE_KEY, OTHER_INCOME_KEY, checkInRows, isOffBudget, rowTotals } from "@/lib/domain/actual-lines";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetException, BudgetLine } from "@/lib/domain/types";
import { validateActual } from "@/lib/domain/validation";
import { makeSettings, makeSnapshot } from "../components/helpers";

const line = (id: string, category: BudgetLine["category"], amount: number, extra: Partial<BudgetLine> = {}): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...extra,
});
const exception = (id: string, month: string, kind: "income" | "expense", amount: number): BudgetException => ({
  id,
  month,
  kind,
  label: id,
  amount,
});

const LINES = [
  line("salary", "income", 280_000),
  line("rent-before", "fixed", 85_000, { endMonth: "2027-06" }),
  line("rent-after", "fixed", 110_000, { startMonth: "2027-07" }),
  line("food", "variable", 40_000, { position: 1 }),
  line("phone", "variable", 2_000, { position: 0 }),
];
const SETTINGS = makeSettings({ startMonth: "2027-01" });

describe("checkInRows", () => {
  it("has the month's active lines grouped like the budget, its exceptions, then the « hors budget » rows", () => {
    const rows = checkInRows(LINES, [exception("bonus", "2027-07", "income", 50_000), exception("trip", "2027-08", "expense", 90_000)], SETTINGS, "2027-07");
    expect(rows.map((r) => [r.section, r.key, r.planned])).toEqual([
      ["income", "salary", 280_000],
      ["income", "bonus", 50_000],
      ["income", OTHER_INCOME_KEY, 0],
      ["fixed", "rent-after", 110_000],
      ["variable", "phone", 2_000],
      ["variable", "food", 40_000],
      ["variable", OTHER_EXPENSE_KEY, 0],
    ]);
    expect(rows.find((r) => r.key === "bonus")).toMatchObject({ kind: "exception", direction: "income", exceptionId: "bonus", category: null });
    expect(rows.find((r) => r.key === "rent-after")).toMatchObject({ kind: "line", direction: "expense", budgetLineId: "rent-after", category: "fixed" });
    expect(rows.find((r) => r.key === OTHER_EXPENSE_KEY)).toMatchObject({ kind: "other", label: "Autres dépenses (hors budget)" });
  });

  it("uses the indexed budget of that month (D27), never for exceptions", () => {
    const settings = makeSettings({ startMonth: "2026-01", expenseInflationRate: 0.02, incomeGrowthRate: 0.01 });
    const rows = checkInRows([line("rent", "fixed", 100_000), line("salary", "income", 200_000)], [exception("gift", "2027-03", "income", 10_000)], settings, "2027-03");
    expect(Object.fromEntries(rows.map((r) => [r.key, r.planned]))).toMatchObject({ rent: 102_000, salary: 202_000, gift: 10_000 });
  });

  it("budgets exactly what the plan counts that month", () => {
    const exceptions = [exception("bonus", "2027-07", "income", 50_000), exception("trip", "2027-07", "expense", 90_000)];
    const settings = makeSettings({ startMonth: "2027-01", expenseInflationRate: 0.03, incomeGrowthRate: 0.015 });
    const plan = computePlan(makeSnapshot({ settings, lines: LINES, exceptions }), "2027-01")!;
    for (const month of ["2027-06", "2027-07", "2028-07"]) {
      const rows = checkInRows(LINES, exceptions, settings, month);
      const planned = rowTotals(rows.map((r) => ({ direction: r.direction, actual: r.planned })));
      const planMonth = plan.result.months.find((m) => m.month === month)!;
      expect(planned).toEqual({ income: planMonth.income, expenses: planMonth.expenses });
    }
  });
});

describe("totals and gaps", () => {
  it("sums income and expense rows", () => {
    expect(
      rowTotals([
        { direction: "income", actual: 280_000 },
        { direction: "income", actual: 1_000 },
        { direction: "expense", actual: 85_000 },
        { direction: "expense", actual: 30_000 },
      ]),
    ).toEqual({ income: 281_000, expenses: 115_000 });
  });

  it("flags an expense above its budget and an income below it, within a tolerance", () => {
    expect(isOffBudget({ direction: "expense", planned: 40_000, actual: 45_000 })).toBe(true);
    expect(isOffBudget({ direction: "expense", planned: 40_000, actual: 39_000 })).toBe(false);
    expect(isOffBudget({ direction: "income", planned: 280_000, actual: 260_000 })).toBe(true);
    expect(isOffBudget({ direction: "income", planned: 280_000, actual: 290_000 })).toBe(false);
    expect(isOffBudget({ direction: "expense", planned: 40_000, actual: 41_000 }, 1_000)).toBe(false);
    expect(isOffBudget({ direction: "expense", planned: 40_000, actual: 41_001 }, 1_000)).toBe(true);
  });
});

describe("validateActual with rows", () => {
  const rows = checkInRows(LINES, [], SETTINGS, "2027-03");
  const ctx = { startMonth: "2027-01", currentMonth: "2027-04", activeLoanIds: [], rows };
  const base = { month: "2027-03", emergencySavings: "0", freeSavings: "0", loanBalances: [] };
  const all = (values: Record<string, string>) => rows.map((r) => ({ key: r.key, actual: values[r.key] ?? "0" }));

  it("requires every row, 0 allowed", () => {
    const result = validateActual({ ...base, lines: all({}).filter((l) => l.key !== "food") }, ctx);
    expect(!result.ok && result.errors).toEqual({ "line.food": "Montant requis" });
  });

  it("keeps a copy of each row and derives the month's income and expenses", () => {
    const result = validateActual({ ...base, lines: all({ salary: "2 850", "rent-before": "850", food: "460", phone: "20", [OTHER_EXPENSE_KEY]: "300" }) }, ctx);
    expect(result.ok && result.value).toMatchObject({ income: 285_000, expenses: 163_000 });
    expect(result.ok && result.value.lines.find((l) => l.budgetLineId === "food")).toEqual({
      kind: "line",
      direction: "expense",
      category: "variable",
      budgetLineId: "food",
      exceptionId: null,
      label: "food",
      planned: 40_000,
      actual: 46_000,
    });
  });

  it("refuses a negative amount", () => {
    const result = validateActual({ ...base, lines: all({ food: "-10" }) }, ctx);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual(["line.food"]);
  });
});
