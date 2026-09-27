/**
 * Calendar months as `YYYY-MM` strings (SPEC decision D3).
 * Pure integer arithmetic: no `Date`, so no time-zone or day-of-month surprises.
 */
export type YearMonth = string;

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH.test(value);
}

/** Months since year 0 (January 2027 → 2027 × 12 + 0). */
export function monthIndex(ym: YearMonth): number {
  const match = YEAR_MONTH.exec(ym);
  if (!match) throw new RangeError(`Invalid YYYY-MM month: "${ym}"`);
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function fromMonthIndex(index: number): YearMonth {
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function addMonths(ym: YearMonth, count: number): YearMonth {
  return fromMonthIndex(monthIndex(ym) + count);
}

/** Number of months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return monthIndex(to) - monthIndex(from);
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return monthIndex(a) - monthIndex(b);
}
