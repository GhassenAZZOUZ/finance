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
import type { CheckInRow } from "@/lib/domain/actual-lines";
import { engineGoalId } from "@/lib/domain/plan";
import type { Loan, MonthlyActual, SavingsGoal } from "@/lib/domain/types";
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

/**
 * The bank statement's totals per budget line into the form rows (#72): every budget line row gets
 * its total (0 without any operation); exceptions and « hors budget » rows are left as typed.
 */
export function applyLineTotals(
  lines: readonly { key: string; actual: string }[],
  rows: readonly CheckInRow[],
  totals: readonly { budgetLineId: string; actual: Cents }[],
): { key: string; actual: string }[] {
  return lines.map((l) => {
    const row = rows.find((r) => r.key === l.key);
    if (row?.kind !== "line") return l;
    return { ...l, actual: amountInputValue(totals.find((t) => t.budgetLineId === row.budgetLineId)?.actual ?? 0) };
  });
}

/** The amount saved for a row of the month, when the check-in has it (the budget line or exception may be new). */
function savedActual(actual: MonthlyActual | undefined, row: CheckInRow): Cents | null {
  const saved = actual?.lines.find((l) =>
    row.kind === "line"
      ? l.kind === "line" && l.budgetLineId === row.budgetLineId
      : row.kind === "exception"
        ? l.kind === "exception" && l.exceptionId === row.exceptionId
        : l.kind === "other" && l.direction === row.direction,
  );
  return saved ? saved.actual : null;
}

/** Form values for `month`: the existing entry when there is one, otherwise empty fields. */
export function prefillForm(
  month: YearMonth,
  actual: MonthlyActual | undefined,
  loans: readonly Pick<Loan, "id">[],
  /** Savings goals (SPEC D23), priority order, the primary one included. */
  goals: readonly { id: string }[] = [],
  /** The month's rows (#72): budget lines, exceptions, « hors budget ». */
  rows: readonly CheckInRow[] = [],
): ActualForm {
  const balances = new Map(actual?.loanBalances.map((b) => [b.loanId, b.balance]));
  const goalBalances = new Map(actual?.goalBalances.map((b) => [b.goalId, b.balance]));
  return {
    month,
    lines: rows.map((row) => ({ key: row.key, actual: amountInputValue(savedActual(actual, row)) })),
    emergencySavings: amountInputValue(actual?.emergencySavings),
    freeSavings: amountInputValue(actual?.freeSavings),
    loanBalances: loans.map((l) => ({ loanId: l.id, balance: amountInputValue(balances.get(l.id)) })),
    goalBalances: goals.map((g) => ({ goalId: g.id, balance: amountInputValue(goalBalances.get(g.id)) })),
  };
}

export interface PlannedValues {
  emergencySavings: Cents;
  freeSavings: Cents;
  income: Cents;
  expenses: Cents;
  /** Same order as the active loans. */
  loanBalances: Cents[];
  /** Same order as the goals given to plannedForMonth. */
  goalBalances: Cents[];
}

/** The plan's expected balances at the end of `month`, or null outside the plan horizon. */
export function plannedForMonth(
  result: PlanResult,
  startMonth: YearMonth,
  month: YearMonth,
  /** Goals to report, in the form's order (SPEC D23). */
  goals: readonly Pick<SavingsGoal, "id" | "primary">[] = [],
): PlannedValues | null {
  if (compareMonths(month, startMonth) < 0) return null;
  const planMonth = result.months[monthsBetween(startMonth, month)];
  if (!planMonth) return null;
  // The engine's goal order = result.kpis.goals, with its own id for the primary goal.
  const goalIndex = new Map(result.kpis.goals.map((g, i) => [g.id, i]));
  const cumulative = (goal: Pick<SavingsGoal, "id" | "primary">) => {
    const index = goalIndex.get(engineGoalId(goal));
    if (index === undefined) return goal.primary ? planMonth.movingCumulative : 0;
    return planMonth.goals[index]?.cumulative ?? 0;
  };
  return {
    goalBalances: goals.map(cumulative),
    emergencySavings: planMonth.emergencyCumulative,
    freeSavings: planMonth.freeSavingsCumulative,
    income: planMonth.income,
    expenses: planMonth.expenses,
    loanBalances: planMonth.loans.map((l) => l.endBalance),
  };
}

/**
 * Loan balances of an early check-in (SPEC D29, issue #61): not entered, taken from the plan after
 * that month's payment (its end balance), as typed strings for the form. "" outside the plan.
 */
export function earlyLoanBalances(
  result: PlanResult,
  startMonth: YearMonth,
  month: YearMonth,
  loanIds: readonly string[],
): { loanId: string; balance: string }[] {
  const planMonth = compareMonths(month, startMonth) < 0 ? undefined : result.months[monthsBetween(startMonth, month)];
  return loanIds.map((loanId, j) => {
    const balance = planMonth?.loans[j]?.endBalance;
    return { loanId, balance: balance === undefined ? "" : amountInputValue(balance) };
  });
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
  const savings = [...(form.goalBalances ?? []).map((b) => b.balance), form.emergencySavings, form.freeSavings].map(value);
  const loans = form.loanBalances.map((b) => value(b.balance));
  const missing = [...savings, ...loans].filter((v) => v === null).length;
  const total = (values: (Cents | null)[]) => (values.every((v) => v !== null) ? sumCents(values as Cents[]) : null);
  const actualSavings = total(savings);
  const actualDebt = total(loans);
  const debtGap = planned && actualDebt !== null ? actualDebt - sumCents(planned.loanBalances) : null;
  const savingsGap =
    planned && actualSavings !== null
      ? actualSavings - (sumCents(planned.goalBalances) + planned.emergencySavings + planned.freeSavings)
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
