/**
 * The rows of a monthly check-in (issue #72): one per budget line active that month, one per
 * one-off exception of the month, and two « hors budget » rows. Each row has the month's budget
 * (D15 period, D27 indexation) and, once saved, the actual amount; saved rows keep a copy of the
 * label, category and budget so the history never changes with the budget.
 */
import { type Cents, type YearMonth, indexationYears, indexedAmount, isLineActive, lineRate, sumCents } from "@/lib/engine";
import { BUDGET_CATEGORIES, type BudgetCategory, type BudgetException, type BudgetLine, type BudgetSettings } from "./types";

export type ActualLineKind = "line" | "exception" | "other";
export type Direction = "income" | "expense";
/** Where a row is shown: the budget's three groups. */
export type RowSection = BudgetCategory;

/** A saved row of a check-in. */
export interface ActualLine {
  kind: ActualLineKind;
  direction: Direction;
  /** The budget line's category at save time; null for exceptions and « hors budget ». */
  category: BudgetCategory | null;
  /** Null once the line or exception is deleted (the copy stays). */
  budgetLineId: string | null;
  exceptionId: string | null;
  label: string;
  /** The month's budget at save time. */
  planned: Cents;
  actual: Cents;
}

/** A row to enter for a month. `key` is the form field suffix: `line.<key>`. */
export interface CheckInRow extends Omit<ActualLine, "actual"> {
  key: string;
  section: RowSection;
}

export const OTHER_INCOME_KEY = "other-income";
export const OTHER_EXPENSE_KEY = "other-expense";

/** The rows of `month`, grouped Revenus / Charges fixes / Dépenses variables, each « hors budget » row last. */
export function checkInRows(
  lines: readonly BudgetLine[],
  exceptions: readonly Pick<BudgetException, "id" | "month" | "kind" | "label" | "amount">[],
  settings: Pick<BudgetSettings, "startMonth" | "expenseInflationRate" | "incomeGrowthRate">,
  month: YearMonth,
): CheckInRow[] {
  const years = indexationYears(settings.startMonth, month);
  const lineRows: CheckInRow[] = [...lines]
    .filter((line) => isLineActive(line, month))
    .sort((a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category) || a.position - b.position)
    .map((line) => ({
      key: line.id,
      section: line.category,
      kind: "line",
      direction: line.category === "income" ? "income" : "expense",
      category: line.category,
      budgetLineId: line.id,
      exceptionId: null,
      label: line.label,
      planned: indexedAmount(line.amount, lineRate(line, settings), years),
    }));
  const exceptionRows: CheckInRow[] = exceptions
    .filter((e) => e.month === month)
    .map((e) => ({
      key: e.id,
      section: e.kind === "income" ? "income" : "variable",
      kind: "exception",
      direction: e.kind,
      category: null,
      budgetLineId: null,
      exceptionId: e.id,
      label: e.label,
      planned: e.amount,
    }));
  const other = (direction: Direction): CheckInRow => ({
    key: direction === "income" ? OTHER_INCOME_KEY : OTHER_EXPENSE_KEY,
    section: direction === "income" ? "income" : "variable",
    kind: "other",
    direction,
    category: null,
    budgetLineId: null,
    exceptionId: null,
    label: direction === "income" ? "Autres revenus (hors budget)" : "Autres dépenses (hors budget)",
    planned: 0,
  });
  const rows = [...lineRows, ...exceptionRows, other("income"), other("expense")];
  return BUDGET_CATEGORIES.flatMap((section) => rows.filter((r) => r.section === section));
}

/** The month's income and expenses: the sums of its rows. */
export function rowTotals(rows: readonly Pick<ActualLine, "direction" | "actual">[]): { income: Cents; expenses: Cents } {
  return {
    income: sumCents(rows.filter((r) => r.direction === "income").map((r) => r.actual)),
    expenses: sumCents(rows.filter((r) => r.direction === "expense").map((r) => r.actual)),
  };
}

/** An expense above its budget or an income below it (± `tolerance`); the gap is actual − planned. */
export function isOffBudget(row: Pick<ActualLine, "direction" | "planned" | "actual">, tolerance = 0): boolean {
  const gap = row.actual - row.planned;
  return row.direction === "income" ? gap < -tolerance : gap > tolerance;
}
