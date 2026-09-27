import {
  type ActualComparison,
  type ActualInput,
  type PlanInput,
  type PlanResult,
  type Cents,
  type YearMonth,
  HORIZON_MONTHS,
  addMonths,
  compareActual,
  compareMonths,
  isLineActive,
  paymentsBeforeStart,
  projectBalance,
  simulatePlan,
  sumCents,
} from "@/lib/engine";
import { currentYearMonth } from "@/lib/format";
import type {
  BudgetCategory,
  BudgetException,
  BudgetLine,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  Loan,
  MonthlyActual,
} from "./types";

type LineLike = Pick<BudgetLine | BudgetLineDraft, "category" | "amount"> &
  Partial<Pick<BudgetLine, "startMonth" | "endMonth">>;

/** Sum of a category; with `month`, only the lines active that month (SPEC D15). */
export function sumCategory(lines: readonly LineLike[], category: BudgetCategory, month?: YearMonth) {
  return sumCents(
    lines
      .filter((l) => l.category === category)
      .filter((l) => !month || isLineActive({ startMonth: l.startMonth ?? null, endMonth: l.endMonth ?? null }, month))
      .map((l) => l.amount),
  );
}

/**
 * Month whose budget the KPIs describe (SPEC D15): the current month, kept within the plan
 * (plan start before it starts, last plan month after it ends).
 */
export function referenceMonth(startMonth: YearMonth, currentMonth: YearMonth): YearMonth {
  const last = addMonths(startMonth, HORIZON_MONTHS - 1);
  if (compareMonths(currentMonth, startMonth) < 0) return startMonth;
  if (compareMonths(currentMonth, last) > 0) return last;
  return currentMonth;
}

/**
 * Remaining principal at the plan start: the balance read by the user, rolled forward with the
 * normal payments made between `principalPaidThroughMonth` and the start (SPEC D5c).
 * Unchanged when no month is given or when it is not before the start.
 */
export function principalAtStart(
  loan: Pick<Loan, "principal" | "principalPaidThroughMonth" | "apr" | "monthlyPayment">,
  startMonth: YearMonth,
): Cents {
  if (!loan.principalPaidThroughMonth) return loan.principal;
  const payments = paymentsBeforeStart(loan.principalPaidThroughMonth, startMonth);
  return payments > 0 ? projectBalance(loan.principal, loan.apr, loan.monthlyPayment, payments) : loan.principal;
}

export function buildPlanInput(
  settings: BudgetSettings,
  lines: readonly LineLike[],
  loans: readonly Loan[],
  exceptions: readonly Pick<BudgetException, "month" | "kind" | "amount">[] = [],
  /** Month the KPI sums describe; defaults to the plan start. */
  kpiMonth: YearMonth = settings.startMonth,
): PlanInput {
  const dated = lines.some((l) => (l.startMonth ?? null) !== null || (l.endMonth ?? null) !== null);
  return {
    budget: {
      income: sumCategory(lines, "income", kpiMonth),
      fixedCosts: sumCategory(lines, "fixed", kpiMonth),
      variableExpenses: sumCategory(lines, "variable", kpiMonth),
      ...settings,
      exceptions: exceptions.map((e) => ({ month: e.month, kind: e.kind, amount: e.amount })),
      // Only needed when some line has a period; otherwise the constant sums are exact.
      ...(dated
        ? {
            lines: lines.map((l) => ({
              category: l.category,
              amount: l.amount,
              startMonth: l.startMonth ?? null,
              endMonth: l.endMonth ?? null,
            })),
          }
        : {}),
    },
    loans: loans.map((l) => ({
      id: l.id,
      name: l.name,
      principal: principalAtStart(l, settings.startMonth),
      apr: l.apr,
      monthlyPayment: l.monthlyPayment,
    })),
  };
}

export function toActualInput(actual: MonthlyActual): ActualInput {
  return {
    month: actual.month,
    income: actual.income,
    expenses: actual.expenses,
    movingSavings: actual.movingSavings,
    emergencySavings: actual.emergencySavings,
    freeSavings: actual.freeSavings,
    loanBalances: actual.loanBalances.map((b) => b.balance),
  };
}

export interface ComputedPlan {
  input: PlanInput;
  /** Month described by the KPIs (SPEC D15). */
  referenceMonth: YearMonth;
  result: PlanResult;
  /** Check-ins compared with the plan, oldest first. */
  comparisons: ActualComparison[];
}

/** Null until the budget parameters exist (first-login onboarding). */
export function computePlan(snapshot: FinanceSnapshot, currentMonth: YearMonth = currentYearMonth()): ComputedPlan | null {
  if (!snapshot.settings) return null;
  const kpiMonth = referenceMonth(snapshot.settings.startMonth, currentMonth);
  const input = buildPlanInput(snapshot.settings, snapshot.lines, snapshot.loans, snapshot.exceptions, kpiMonth);
  const result = simulatePlan(input);
  const comparisons = snapshot.actuals.map((a) => compareActual(toActualInput(a), result, input.budget));
  return { input, referenceMonth: kpiMonth, result, comparisons };
}
