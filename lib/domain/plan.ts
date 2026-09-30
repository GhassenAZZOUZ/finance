import {
  type ActualComparison,
  type ActualInput,
  type PlanInput,
  type PlanResult,
  type Cents,
  type YearMonth,
  HORIZON_MONTHS,
  PRIMARY_GOAL_ID,
  addMonths,
  compareActual,
  compareMonths,
  indexationYears,
  indexedAmount,
  isLineActive,
  lineRate,
  paymentsBeforeStart,
  projectBalance,
  simulatePlan,
  sumCents,
} from "@/lib/engine";
import { currentYearMonth } from "@/lib/format";
import { withComputedBalances } from "./deposits";
import type {
  BudgetCategory,
  BudgetException,
  BudgetLine,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  Loan,
  MonthlyActual,
  SavingsGoal,
} from "./types";

type LineLike = Pick<BudgetLine | BudgetLineDraft, "category" | "amount"> &
  Partial<Pick<BudgetLine, "startMonth" | "endMonth" | "indexed">>;

type IndexSettings = Pick<BudgetSettings, "startMonth" | "expenseInflationRate" | "incomeGrowthRate">;

/**
 * Sum of a category; with `month`, only the lines active that month (SPEC D15), and with
 * `indexation` too, each line indexed to that month's year (D27).
 */
export function sumCategory(lines: readonly LineLike[], category: BudgetCategory, month?: YearMonth, indexation?: IndexSettings) {
  const years = month && indexation ? indexationYears(indexation.startMonth, month) : 0;
  return sumCents(
    lines
      .filter((l) => l.category === category)
      .filter((l) => !month || isLineActive({ startMonth: l.startMonth ?? null, endMonth: l.endMonth ?? null }, month))
      .map((l) => (indexation ? indexedAmount(l.amount, lineRate(l, indexation), years) : l.amount)),
  );
}

/** Some yearly rate is set (SPEC D27). */
export function isIndexed(settings: Pick<BudgetSettings, "expenseInflationRate" | "incomeGrowthRate">): boolean {
  return (settings.expenseInflationRate ?? 0) !== 0 || (settings.incomeGrowthRate ?? 0) !== 0;
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
  /** Savings goals in priority order, the primary one included (SPEC D23). */
  goals: readonly SavingsGoal[] = [],
): PlanInput {
  const dated = lines.some((l) => (l.startMonth ?? null) !== null || (l.endMonth ?? null) !== null);
  // Indexed plans (D27) need the lines: each one is rounded on its own, and some may be « non indexé ».
  const indexed = isIndexed(settings);
  // The engine keeps the spreadsheet's shape: the primary goal is its moving fund (no goal: 0 €).
  const primary = goals.find((g) => g.primary);
  return {
    budget: {
      // The KPIs describe the reference month, at that month's indexed amounts (D27).
      income: sumCategory(lines, "income", kpiMonth, settings),
      fixedCosts: sumCategory(lines, "fixed", kpiMonth, settings),
      variableExpenses: sumCategory(lines, "variable", kpiMonth, settings),
      ...settings,
      movingGoal: primary?.target ?? 0,
      movingDeadlineMonth: primary?.deadlineMonth ?? settings.startMonth,
      movingAlreadySaved: primary?.alreadySaved ?? 0,
      movingName: primary?.name ?? NO_GOAL_NAME,
      // Only when set, so a plan without savings interest gives the exact same input as before (D28).
      ...(primary?.rate ? { movingRate: primary.rate } : {}),
      exceptions: exceptions.map((e) => ({ month: e.month, kind: e.kind, amount: e.amount })),
      // Only with extra goals, so a moving fund alone gives the exact same input as before (D23).
      ...(goals.some((g) => !g.primary) ? { goals: goalInputs(goals) } : {}),
      // Only needed when some line has a period; otherwise the constant sums are exact.
      ...(dated || indexed
        ? {
            lines: lines.map((l) => ({
              category: l.category,
              amount: l.amount,
              startMonth: l.startMonth ?? null,
              endMonth: l.endMonth ?? null,
              ...(l.indexed === false ? { indexed: false } : {}),
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
      // Only when set, so a loan without IRA gives the exact same input as before (D22).
      ...(l.penaltyPct ? { penaltyPct: l.penaltyPct, penaltyCapMonths: l.penaltyCapMonths } : {}),
      // Only for an overdraft, so a loan gives the exact same input as before (D24).
      ...(l.kind === "overdraft" ? { kind: "overdraft" as const, limit: l.creditLimit ?? 0 } : {}),
    })),
  };
}

/** Name of the (empty) moving fund of a user without savings goals. */
export const NO_GOAL_NAME = "Objectif d’épargne";

/** Id of a goal in the engine's input and results: the primary goal is PRIMARY_GOAL_ID there. */
export function engineGoalId(goal: Pick<SavingsGoal, "id" | "primary">): string {
  return goal.primary ? PRIMARY_GOAL_ID : goal.id;
}

/** Goals in priority order for the engine. */
function goalInputs(goals: readonly SavingsGoal[]) {
  return [...goals]
    .sort((a, b) => a.priority - b.priority)
    .map((g) => ({
      id: engineGoalId(g),
      name: g.name,
      target: g.target,
      deadlineMonth: g.deadlineMonth,
      alreadySaved: g.alreadySaved,
      ...(g.rate ? { rate: g.rate } : {}),
    }));
}

export function toActualInput(actual: MonthlyActual): ActualInput {
  return {
    month: actual.month,
    income: actual.income,
    expenses: actual.expenses,
    // All goals together (SPEC D23).
    movingSavings: sumCents(actual.goalBalances.map((b) => b.balance)),
    emergencySavings: actual.emergencySavings,
    freeSavings: actual.freeSavings,
    loanBalances: actual.loanBalances.map((b) => b.balance),
    planned: actual.frozen
      ? {
          debt: actual.frozen.plannedDebt,
          savings: actual.frozen.plannedSavings,
          income: actual.frozen.plannedIncome,
          expenses: actual.frozen.plannedExpenses,
        }
      : null,
  };
}

export interface ComputedPlan {
  input: PlanInput;
  /** Month described by the KPIs (SPEC D15). */
  referenceMonth: YearMonth;
  result: PlanResult;
  /** Check-ins compared with the plan, oldest first. */
  comparisons: ActualComparison[];
  /** The check-ins with their balances computed from the deposits (SPEC D33), oldest first. */
  actuals: MonthlyActual[];
}

/** Null until the budget parameters exist (first-login onboarding). */
export function computePlan(snapshot: FinanceSnapshot, currentMonth: YearMonth = currentYearMonth()): ComputedPlan | null {
  if (!snapshot.settings) return null;
  const kpiMonth = referenceMonth(snapshot.settings.startMonth, currentMonth);
  const input = buildPlanInput(snapshot.settings, snapshot.lines, snapshot.loans, snapshot.exceptions, kpiMonth, snapshot.goals);
  const result = simulatePlan(input);
  const actuals = withComputedBalances(result, snapshot.settings, snapshot.goals, snapshot.actuals);
  const comparisons = actuals.map((a) => compareActual(toActualInput(a), result, input.budget));
  return { input, referenceMonth: kpiMonth, result, comparisons, actuals };
}

/**
 * The snapshot with its check-ins' balances computed from the deposits (SPEC D33), and its plan:
 * what every page and action reads.
 */
export function withPlan(snapshot: FinanceSnapshot, currentMonth?: YearMonth): { snapshot: FinanceSnapshot; plan: ComputedPlan | null } {
  const plan = computePlan(snapshot, currentMonth);
  return { snapshot: plan ? { ...snapshot, actuals: plan.actuals } : snapshot, plan };
}
