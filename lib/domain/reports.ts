/**
 * Pro reports (issue #145, US-8; owner decision 2026-10-07): actual vs budget per budget line over
 * 12 months, recurring overspends, totals per tag. Pure: computed in the browser from the check-ins'
 * rows (#72), never sent anywhere.
 */
import { type Cents, type YearMonth, addMonths, compareMonths } from "@/lib/engine";
import type { BudgetCategory, BudgetLine, MonthlyActual } from "./types";

/** Months shown by the report. */
export const REPORT_MONTHS = 12;
/** A row is off budget beyond this gap (same tolerance as the check-in verdict, SPEC D32). */
export const REPORT_TOLERANCE: Cents = 1_000;
/** Off budget in at least this many months: a recurring overspend. */
export const RECURRING_MONTHS = 3;

export const NO_TAG = "Sans étiquette";

export interface ReportCell {
  planned: Cents;
  actual: Cents;
  /** Expense over budget, or income under it, beyond the tolerance. */
  off: boolean;
}

export interface LineReport {
  /** The budget line id, or `label:<label>` for a line deleted since. */
  key: string;
  label: string;
  category: BudgetCategory | null;
  direction: "income" | "expense";
  tag: string | null;
  /** One cell per report month (oldest first); null = no check-in row that month. */
  cells: (ReportCell | null)[];
  offMonths: number;
  recurring: boolean;
  totalPlanned: Cents;
  totalActual: Cents;
}

/** The report's months, oldest first, ending with `endMonth`. */
export function reportMonths(endMonth: YearMonth, count = REPORT_MONTHS): YearMonth[] {
  return Array.from({ length: count }, (_, i) => addMonths(endMonth, i - count + 1));
}

const CATEGORY_ORDER: Record<BudgetCategory, number> = { income: 0, fixed: 1, variable: 2 };

/** Budget-line rows of the check-ins in the report's months, one report per line. */
export function lineReports(actuals: readonly MonthlyActual[], lines: readonly BudgetLine[], endMonth: YearMonth, count = REPORT_MONTHS): LineReport[] {
  const months = reportMonths(endMonth, count);
  const first = months[0]!;
  const byId = new Map(lines.map((l) => [l.id, l]));
  const reports = new Map<string, LineReport>();
  for (const actual of actuals) {
    if (compareMonths(actual.month, first) < 0 || compareMonths(actual.month, endMonth) > 0) continue;
    const index = months.indexOf(actual.month);
    for (const row of actual.lines) {
      if (row.kind !== "line") continue;
      const key = row.budgetLineId ?? `label:${row.label}`;
      const line = row.budgetLineId ? byId.get(row.budgetLineId) : undefined;
      let report = reports.get(key);
      if (!report) {
        report = {
          key,
          label: line?.label ?? row.label,
          category: line?.category ?? row.category,
          direction: row.direction,
          tag: line?.tag ?? null,
          cells: months.map(() => null),
          offMonths: 0,
          recurring: false,
          totalPlanned: 0,
          totalActual: 0,
        };
        reports.set(key, report);
      }
      const gap = row.actual - row.planned;
      const off = row.direction === "expense" ? gap > REPORT_TOLERANCE : gap < -REPORT_TOLERANCE;
      report.cells[index] = { planned: row.planned, actual: row.actual, off };
      report.totalPlanned += row.planned;
      report.totalActual += row.actual;
      if (off) report.offMonths += 1;
    }
  }
  return [...reports.values()]
    .map((r) => ({ ...r, recurring: r.offMonths >= RECURRING_MONTHS }))
    .sort(
      (a, b) =>
        (a.category ? CATEGORY_ORDER[a.category] : 3) - (b.category ? CATEGORY_ORDER[b.category] : 3) || a.label.localeCompare(b.label, "fr"),
    );
}

export interface TagTotal {
  tag: string;
  planned: Cents;
  actual: Cents;
}

/** Expenses per tag over the report (« Sans étiquette » last), for the « par étiquette » table. */
export function tagTotals(reports: readonly LineReport[]): TagTotal[] {
  const totals = new Map<string, TagTotal>();
  for (const r of reports) {
    if (r.direction !== "expense") continue;
    const tag = r.tag ?? NO_TAG;
    const t = totals.get(tag) ?? { tag, planned: 0, actual: 0 };
    t.planned += r.totalPlanned;
    t.actual += r.totalActual;
    totals.set(tag, t);
  }
  return [...totals.values()].sort((a, b) => (a.tag === NO_TAG ? 1 : b.tag === NO_TAG ? -1 : a.tag.localeCompare(b.tag, "fr")));
}

/** The tags in use, sorted, for the filter and the suggestions. */
export function tagsInUse(lines: readonly BudgetLine[]): string[] {
  return [...new Set(lines.map((l) => l.tag).filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b, "fr"));
}
