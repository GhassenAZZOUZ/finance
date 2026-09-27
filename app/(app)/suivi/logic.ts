/** Pure helpers of the /suivi page (unit-tested in tests/unit/suivi-logic.test.ts). */
import {
  type ActualComparison,
  type ActualStatus,
  type Cents,
  GAP_TOLERANCE,
  type PlanResult,
  type YearMonth,
  addMonths,
  compareMonths,
  monthsBetween,
  statusFor,
  sumCents,
} from "@/lib/engine";
import { type ActualForm, parseAmount } from "@/lib/domain/validation";
import type { Loan, MonthlyActual } from "@/lib/domain/types";
import { amountInputValue, formatMonthLong, formatMonthShort } from "@/lib/format";

/** Months open to a check-in, newest first: from `startMonth` to `currentMonth` (SPEC D6). */
export function checkInMonths(startMonth: YearMonth, currentMonth: YearMonth): YearMonth[] {
  const count = monthsBetween(startMonth, currentMonth);
  const months: YearMonth[] = [];
  for (let i = count; i >= 0; i--) months.push(addMonths(startMonth, i));
  return months;
}

/**
 * Months open to a check-in that have none yet, oldest first (sidebar badge, "À faire", dashboard).
 * The current month counts: it is entered at its end. Empty before the plan starts.
 */
export function pendingCheckIns(startMonth: YearMonth, currentMonth: YearMonth, entered: readonly YearMonth[]): YearMonth[] {
  if (compareMonths(startMonth, currentMonth) > 0) return [];
  const done = new Set(entered);
  return checkInMonths(startMonth, currentMonth)
    .filter((m) => !done.has(m))
    .reverse();
}

/** Month preselected on /suivi from `?mois=`, when it is one of the open months. */
export function parseMonthParam(param: string | null, months: readonly YearMonth[]): YearMonth | null {
  return param && months.includes(param) ? param : null;
}

/** "août 2026", "août et septembre 2026", "juin, juillet et août 2026", "déc. 2026 → mars 2027"… */
export function pendingMonthsText(months: readonly YearMonth[]): string {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return "";
  if (months.length > 3) return `${formatMonthShort(first)} → ${formatMonthShort(last)}`;
  if (months.every((m) => m.slice(0, 4) === first.slice(0, 4))) {
    const names = months.map((m) => formatMonthLong(m).replace(/ \d{4}$/, ""));
    return `${joinFrench(names)} ${first.slice(0, 4)}`;
  }
  return joinFrench(months.map(formatMonthLong));
}

function joinFrench(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
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

export interface ProvisionalCheck {
  /** Required balances (savings + loans) still empty or invalid. */
  missing: number;
  /** Σ entered loan balances − Σ planned (null while a loan balance is missing). */
  debtGap: Cents | null;
  /** Σ entered savings − Σ planned (null while a savings balance is missing). */
  savingsGap: Cents | null;
  /** Engine rule (SPEC §8.2) once both gaps are known. */
  status: ActualStatus | null;
}

/** Status the check-in would get with the values typed so far (sticky footer of the form). */
export function provisionalCheck(form: ActualForm, planned: PlannedValues | null): ProvisionalCheck {
  const value = (raw: string) => {
    const parsed = parseAmount(raw);
    return parsed.ok ? parsed.value : null;
  };
  const savings = [form.movingSavings, form.emergencySavings, form.freeSavings].map(value);
  const loans = form.loanBalances.map((b) => value(b.balance));
  const missing = [...savings, ...loans].filter((v) => v === null).length;
  const total = (values: (Cents | null)[]) => (values.every((v) => v !== null) ? sumCents(values as Cents[]) : null);
  const actualSavings = total(savings);
  const actualDebt = total(loans);
  const debtGap = planned && actualDebt !== null ? actualDebt - sumCents(planned.loanBalances) : null;
  const savingsGap =
    planned && actualSavings !== null
      ? actualSavings - (planned.movingSavings + planned.emergencySavings + planned.freeSavings)
      : null;
  return { missing, debtGap, savingsGap, status: debtGap !== null && savingsGap !== null ? statusFor(debtGap, savingsGap) : null };
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
