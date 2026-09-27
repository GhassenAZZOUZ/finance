import {
  type ActualComparison,
  type ActualInput,
  type PlanInput,
  type PlanResult,
  type Cents,
  type YearMonth,
  compareActual,
  paymentsBeforeStart,
  projectBalance,
  simulatePlan,
  sumCents,
} from "@/lib/engine";
import type { BudgetCategory, BudgetLine, BudgetLineDraft, BudgetSettings, FinanceSnapshot, Loan, MonthlyActual } from "./types";

export function sumCategory(lines: readonly Pick<BudgetLine | BudgetLineDraft, "category" | "amount">[], category: BudgetCategory) {
  return sumCents(lines.filter((l) => l.category === category).map((l) => l.amount));
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
  lines: readonly Pick<BudgetLine | BudgetLineDraft, "category" | "amount">[],
  loans: readonly Loan[],
): PlanInput {
  return {
    budget: {
      income: sumCategory(lines, "income"),
      fixedCosts: sumCategory(lines, "fixed"),
      variableExpenses: sumCategory(lines, "variable"),
      ...settings,
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
  result: PlanResult;
  /** Check-ins compared with the plan, oldest first. */
  comparisons: ActualComparison[];
}

/** Null until the budget parameters exist (first-login onboarding). */
export function computePlan(snapshot: FinanceSnapshot): ComputedPlan | null {
  if (!snapshot.settings) return null;
  const input = buildPlanInput(snapshot.settings, snapshot.lines, snapshot.loans);
  const result = simulatePlan(input);
  const comparisons = snapshot.actuals.map((a) => compareActual(toActualInput(a), result, input.budget));
  return { input, result, comparisons };
}
