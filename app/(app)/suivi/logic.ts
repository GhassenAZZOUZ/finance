/** Pure helpers of the /suivi page (unit-tested in tests/unit/suivi-logic.test.ts). */
import { type ActualComparison, type Cents, GAP_TOLERANCE, type PlanResult, type YearMonth, addMonths, compareMonths, monthsBetween } from "@/lib/engine";
import type { ActualForm } from "@/lib/domain/validation";
import type { Loan, MonthlyActual } from "@/lib/domain/types";
import { amountInputValue } from "@/lib/format";

/** Months open to a check-in, newest first: from `startMonth` to `currentMonth` (SPEC D6). */
export function checkInMonths(startMonth: YearMonth, currentMonth: YearMonth): YearMonth[] {
  const count = monthsBetween(startMonth, currentMonth);
  const months: YearMonth[] = [];
  for (let i = count; i >= 0; i--) months.push(addMonths(startMonth, i));
  return months;
}

/** Form values for `month`: the existing entry when there is one, otherwise empty fields. */
export function prefillForm(month: YearMonth, actual: MonthlyActual | undefined, loans: readonly Pick<Loan, "id">[]): ActualForm {
  const balances = new Map(actual?.loanBalances.map((b) => [b.loanId, b.balance]));
  return {
    month,
    income: amountInputValue(actual?.income),
    expenses: amountInputValue(actual?.expenses),
    movingSavings: amountInputValue(actual?.movingSavings),
    emergencySavings: amountInputValue(actual?.emergencySavings),
    freeSavings: amountInputValue(actual?.freeSavings),
    loanBalances: loans.map((l) => ({ loanId: l.id, balance: amountInputValue(balances.get(l.id)) })),
  };
}

export interface PlannedValues {
  movingSavings: Cents;
  emergencySavings: Cents;
  freeSavings: Cents;
  income: Cents;
  expenses: Cents;
  /** Same order as the active loans. */
  loanBalances: Cents[];
}

/** The plan's expected balances at the end of `month`, or null outside the plan horizon. */
export function plannedForMonth(result: PlanResult, startMonth: YearMonth, month: YearMonth): PlannedValues | null {
  if (compareMonths(month, startMonth) < 0) return null;
  const planMonth = result.months[monthsBetween(startMonth, month)];
  if (!planMonth) return null;
  return {
    movingSavings: planMonth.movingCumulative,
    emergencySavings: planMonth.emergencyCumulative,
    freeSavings: planMonth.freeSavingsCumulative,
    income: planMonth.income,
    expenses: planMonth.expenses,
    loanBalances: planMonth.loans.map((l) => l.endBalance),
  };
}

/** Debt gap is good when actual debt ≤ planned + 10 € (inclusive, SPEC §8.2). */
export function isDebtGapGood(gap: Cents): boolean {
  return gap <= GAP_TOLERANCE;
}

/** Savings gap is good when actual savings ≥ planned − 10 € (inclusive, SPEC §8.2). */
export function isSavingsGapGood(gap: Cents): boolean {
  return gap >= -GAP_TOLERANCE;
}

/** Newest first. */
export function newestFirst<T extends { month: YearMonth }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => compareMonths(b.month, a.month));
}

export interface HistoryEntry {
  comparison: ActualComparison;
  /** Raw entry (income / expenses as typed). */
  actual: MonthlyActual | undefined;
}

/** History rows, newest first, pairing each comparison with its raw entry. */
export function buildHistory(comparisons: readonly ActualComparison[], actuals: readonly MonthlyActual[]): HistoryEntry[] {
  const byMonth = new Map(actuals.map((a) => [a.month, a]));
  return newestFirst(comparisons).map((comparison) => ({ comparison, actual: byMonth.get(comparison.month) }));
}
