/** Pro reports (issue #145): actual vs budget per line over 12 months, recurring overspends, tags. */
import { describe, expect, it } from "vitest";
import type { ActualLine } from "@/lib/domain/actual-lines";
import { NO_TAG, lineReports, reportMonths, tagTotals, tagsInUse } from "@/lib/domain/reports";
import type { BudgetLine, MonthlyActual } from "@/lib/domain/types";

const line = (id: string, category: BudgetLine["category"], label: string, tag?: string): BudgetLine => ({
  id,
  category,
  label,
  amount: 0,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...(tag ? { tag } : {}),
});
const row = (budgetLineId: string | null, label: string, direction: "income" | "expense", planned: number, actual: number): ActualLine => ({
  kind: "line",
  direction,
  category: direction === "income" ? "income" : "variable",
  budgetLineId,
  exceptionId: null,
  label,
  planned,
  actual,
});
const checkIn = (month: string, lines: ActualLine[]): MonthlyActual =>
  ({ id: month, month, income: null, expenses: null, lines, emergencySavings: 0, freeSavings: 0, goalBalances: [], loanBalances: [], frozen: null }) as MonthlyActual;

const LINES = [line("salary", "income", "Salaire"), line("food", "variable", "Courses", "Alimentation"), line("rent", "fixed", "Loyer", "Logement")];

describe("reportMonths", () => {
  it("is the 12 months ending with the given one, oldest first", () => {
    const months = reportMonths("2027-03");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-04");
    expect(months.at(-1)).toBe("2027-03");
  });
});

describe("lineReports", () => {
  const actuals = [
    checkIn("2026-12", [row("food", "Courses", "expense", 40_000, 45_000), row("salary", "Salaire", "income", 300_000, 300_000)]),
    checkIn("2027-01", [row("food", "Courses", "expense", 40_000, 41_000), row("salary", "Salaire", "income", 300_000, 285_000)]),
    checkIn("2027-02", [row("food", "Courses", "expense", 40_000, 46_000), row("rent", "Loyer", "expense", 90_000, 90_000)]),
    checkIn("2027-03", [row("food", "Courses", "expense", 40_000, 52_000), row(null, "Ancienne ligne", "expense", 5_000, 5_000)]),
    // Outside the 12 months: ignored.
    checkIn("2026-03", [row("food", "Courses", "expense", 40_000, 99_000)]),
  ];
  const reports = lineReports(actuals, LINES, "2027-03");
  const food = reports.find((r) => r.key === "food")!;

  it("puts each month's actual and budget in its column, empty without a check-in row", () => {
    expect(food.cells.filter(Boolean)).toHaveLength(4);
    expect(food.cells[8]).toEqual({ planned: 40_000, actual: 45_000, off: true });
    expect(food.cells[0]).toBeNull();
    expect(food.totalActual).toBe(184_000);
    expect(food.totalPlanned).toBe(160_000);
  });

  it("flags an expense over budget or an income under it beyond 10 €, recurring from 3 months", () => {
    // 45 000 (+50 €), 41 000 (+10 € exactly: not off), 46 000, 52 000.
    expect(food.offMonths).toBe(3);
    expect(food.recurring).toBe(true);
    const salary = reports.find((r) => r.key === "salary")!;
    expect(salary.offMonths).toBe(1);
    expect(salary.recurring).toBe(false);
  });

  it("keeps the line's current tag and label, and a deleted line under its saved label", () => {
    expect(food.tag).toBe("Alimentation");
    const deleted = reports.find((r) => r.key === "label:Ancienne ligne")!;
    expect(deleted.tag).toBeNull();
    expect(reports.map((r) => r.label)).toEqual(["Salaire", "Loyer", "Ancienne ligne", "Courses"]);
  });

  it("totals the expenses per tag, « Sans étiquette » last", () => {
    expect(tagTotals(reports)).toEqual([
      { tag: "Alimentation", planned: 160_000, actual: 184_000 },
      { tag: "Logement", planned: 90_000, actual: 90_000 },
      { tag: NO_TAG, planned: 5_000, actual: 5_000 },
    ]);
  });
});

describe("tagsInUse", () => {
  it("lists each tag once, sorted", () => {
    expect(tagsInUse([...LINES, line("x", "fixed", "Box", "Logement")])).toEqual(["Alimentation", "Logement"]);
  });
});
