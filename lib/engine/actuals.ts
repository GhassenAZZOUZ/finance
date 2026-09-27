import { type Cents, sumCents } from "./money";
import { compareMonths, monthsBetween } from "./months";
import {
  HORIZON_MONTHS,
  type ActualComparison,
  type ActualInput,
  type ActualStatus,
  type BudgetParams,
  type PlanResult,
  type PlannedSnapshot,
} from "./types";

/** ±10 € tolerance of the spreadsheet status (inclusive). */
export const GAP_TOLERANCE: Cents = 1000;

export function statusFor(debtGap: Cents, savingsGap: Cents): ActualStatus {
  const debtOk = debtGap <= GAP_TOLERANCE;
  const savingsOk = savingsGap >= -GAP_TOLERANCE;
  if (debtOk && savingsOk) return "onTrack";
  if (!debtOk && !savingsOk) return "late";
  return "mixed";
}

/** Compares one monthly check-in with the plan (spreadsheet `Suivi réel!M:U`, SPEC §8.2). */
export function compareActual(actual: ActualInput, plan: PlanResult, budget: BudgetParams): ActualComparison {
  const offset = monthsBetween(budget.startMonth, actual.month);
  const planMonth = offset >= 0 && offset < HORIZON_MONTHS ? plan.months[offset] : undefined;

  const actualDebt = sumCents(actual.loanBalances);
  const actualSavings = actual.movingSavings + actual.emergencySavings + actual.freeSavings;
  // Frozen values win (SPEC D16): a re-based plan must not rewrite the history.
  const frozen = actual.planned ?? null;
  const plannedDebt = frozen ? frozen.debt : planMonth ? planMonth.remainingDebt : null;
  const plannedSavings = frozen
    ? frozen.savings
    : planMonth
      ? planMonth.movingCumulative + planMonth.emergencyCumulative + planMonth.freeSavingsCumulative
      : null;
  const debtGap = plannedDebt === null ? null : actualDebt - plannedDebt;
  const savingsGap = plannedSavings === null ? null : actualSavings - plannedSavings;
  const totalPrincipal = plan.kpis.totalPrincipal;
  // That month's budget, exceptions included (SPEC D14); the regular budget outside the plan.
  const plannedIncome = frozen ? frozen.income : planMonth ? planMonth.income : budget.income;
  const plannedExpenses = frozen
    ? frozen.expenses
    : planMonth
      ? planMonth.expenses
      : budget.fixedCosts + budget.variableExpenses;

  return {
    month: actual.month,
    planIndex: planMonth ? planMonth.index : null,
    actualDebt,
    plannedDebt,
    debtGap,
    actualSavings,
    plannedSavings,
    savingsGap,
    movingGoalPct: budget.movingGoal > 0 ? Math.min(1, actual.movingSavings / budget.movingGoal) : 0,
    debtRepaidPct: totalPrincipal > 0 ? Math.max(0, 1 - actualDebt / totalPrincipal) : 0,
    status: debtGap === null || savingsGap === null ? null : statusFor(debtGap, savingsGap),
    incomeGap: actual.income === null ? null : actual.income - plannedIncome,
    expensesGap: actual.expenses === null ? null : actual.expenses - plannedExpenses,
  };
}

/** Most recent check-in (SPEC §8.3), or null when there is none. */
export function latestActual<T extends { month: string }>(entries: readonly T[]): T | null {
  let latest: T | null = null;
  for (const entry of entries) {
    if (latest === null || compareMonths(entry.month, latest.month) > 0) latest = entry;
  }
  return latest;
}

/** The plan's expectation for `month`, to freeze with a check-in (SPEC D16); null outside the plan. */
export function plannedSnapshot(plan: PlanResult, budget: BudgetParams, month: string): PlannedSnapshot | null {
  const offset = monthsBetween(budget.startMonth, month);
  const m = offset >= 0 && offset < HORIZON_MONTHS ? plan.months[offset] : undefined;
  if (!m) return null;
  return {
    debt: m.remainingDebt,
    savings: m.movingCumulative + m.emergencyCumulative + m.freeSavingsCumulative,
    income: m.income,
    expenses: m.expenses,
  };
}
