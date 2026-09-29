/**
 * Income paydays (SPEC D29, issue #60): each income line has a usual payday, and a month can record
 * the actual date an income was paid. Dates are YYYY-MM-DD strings, read in Europe/Paris.
 */
import { type YearMonth, addMonths, isLineActive } from "@/lib/engine";
import type { BudgetLine, IncomePayment } from "./types";

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Number of days of a YYYY-MM month (28 to 31). */
export function daysInMonth(month: YearMonth): number {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** The line's usual payday; 1 of the same month when unset. */
export function paydayOf(line: Pick<BudgetLine, "paydayDay" | "paydayPreviousMonth">): { day: number; previousMonth: boolean } {
  return { day: line.paydayDay ?? 1, previousMonth: line.paydayPreviousMonth ?? false };
}

/** Date the usual payday gives for `month`'s income; a day the month lacks is its last day. */
export function expectedPayDate(line: Pick<BudgetLine, "paydayDay" | "paydayPreviousMonth">, month: YearMonth): IsoDate {
  const { day, previousMonth } = paydayOf(line);
  const paidIn = previousMonth ? addMonths(month, -1) : month;
  return `${paidIn}-${String(Math.min(day, daysInMonth(paidIn))).padStart(2, "0")}`;
}

/** Income lines that fund `month`: category income, amount > 0, active that month (D15). */
export function incomeLinesFor<L extends BudgetLine>(lines: readonly L[], month: YearMonth): L[] {
  return lines.filter((l) => l.category === "income" && l.amount > 0 && isLineActive(l, month));
}

/** The recorded exception for (month, line), if any. */
export function paymentFor(payments: readonly IncomePayment[], month: YearMonth, lineId: string): IncomePayment | undefined {
  return payments.find((p) => p.month === month && p.budgetLineId === lineId);
}

/** The exception when there is one, else the usual payday's date. */
export function effectivePayDate(line: BudgetLine, month: YearMonth, payments: readonly IncomePayment[]): IsoDate {
  return paymentFor(payments, month, line.id)?.paidOn ?? expectedPayDate(line, month);
}

/** First and last allowed exception dates for `month`: the 1st of the month before, the last day of `month`. */
export function paidOnBounds(month: YearMonth): { first: IsoDate; last: IsoDate } {
  return { first: `${addMonths(month, -1)}-01`, last: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const month = `${match[1]}-${match[2]}`;
  const day = Number(match[3]);
  return Number(match[2]) >= 1 && Number(match[2]) <= 12 && day >= 1 && day <= daysInMonth(month);
}

/**
 * When `month` opens to a check-in (SPEC D29, issue #61): the earliest effective payment date of its
 * income lines, i.e. the day its first income is paid, with that line. Null without income lines.
 */
export function openingOf(
  lines: readonly BudgetLine[],
  month: YearMonth,
  payments: readonly IncomePayment[],
): { date: IsoDate; line: BudgetLine } | null {
  let first: { date: IsoDate; line: BudgetLine } | null = null;
  for (const line of incomeLinesFor(lines, month)) {
    const date = effectivePayDate(line, month, payments);
    if (!first || date < first.date) first = { date, line };
  }
  return first;
}

/**
 * Last month open to a check-in (SPEC D6, D29): the next month once its first income has been paid
 * (opening date ≤ today, Europe/Paris), else the current month. Never further than the next month.
 */
export function lastOpenMonth(
  currentMonth: YearMonth,
  today: IsoDate,
  lines: readonly BudgetLine[],
  payments: readonly IncomePayment[],
): YearMonth {
  const next = addMonths(currentMonth, 1);
  const opening = openingOf(lines, next, payments);
  return opening && opening.date <= today ? next : currentMonth;
}
