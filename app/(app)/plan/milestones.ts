/**
 * Plan table highlighting (SPEC D11): which month first reaches each milestone.
 * Pure functions so they can be unit-tested without rendering.
 */
import { HORIZON_MONTHS, type PlanInput, type PlanResult, type YearMonth, monthsBetween } from "@/lib/engine";

export const DEFAULT_ROW_COUNT = 24;

/** `?mois=300` shows the whole horizon; anything else shows the first 24 months. */
export function parseRowCount(param: string | string[] | undefined): number {
  const value = Array.isArray(param) ? param[0] : param;
  return value === String(HORIZON_MONTHS) ? HORIZON_MONTHS : DEFAULT_ROW_COUNT;
}

export interface PlanMilestones {
  /** 1-based plan month index of the first month with the flag set, or null. */
  movingIndex: number | null;
  emergencyIndex: number | null;
  debtFreeIndex: number | null;
  /** Plan month equal to the moving deadline, null when outside the horizon. */
  deadlineIndex: number | null;
  /** Plan month index → display names of the loans paid off that month. */
  loanPayoffs: ReadonlyMap<number, readonly string[]>;
  negativeCount: number;
  firstNegativeMonth: YearMonth | null;
}

/** Plan month index (1-based) of a calendar month, or null when outside the simulated months. */
export function planIndexOf(month: YearMonth, startMonth: YearMonth, monthCount: number): number | null {
  const index = monthsBetween(startMonth, month) + 1;
  return index >= 1 && index <= monthCount ? index : null;
}

export function findMilestones(input: PlanInput, result: PlanResult): PlanMilestones {
  const { months } = result;
  const { budget } = input;
  const firstIndex = (predicate: (m: (typeof months)[number]) => boolean) => months.find(predicate)?.index ?? null;

  const loanPayoffs = new Map<number, string[]>();
  for (const loan of result.loans) {
    if (!loan.payoffMonthWithPlan) continue;
    const index = planIndexOf(loan.payoffMonthWithPlan, budget.startMonth, months.length);
    if (index === null) continue;
    loanPayoffs.set(index, [...(loanPayoffs.get(index) ?? []), loan.displayName]);
  }

  const negatives = months.filter((m) => m.negativeBudget);

  return {
    // A zero goal / target / no loan is "reached" from month 1: nothing worth highlighting.
    movingIndex: budget.movingGoal > 0 ? firstIndex((m) => m.movingReached) : null,
    emergencyIndex: budget.emergencyTarget > 0 ? firstIndex((m) => m.emergencyReached) : null,
    debtFreeIndex: input.loans.length > 0 ? firstIndex((m) => m.debtFree) : null,
    deadlineIndex: planIndexOf(budget.movingDeadlineMonth, budget.startMonth, months.length),
    loanPayoffs,
    negativeCount: negatives.length,
    firstNegativeMonth: negatives[0]?.month ?? null,
  };
}

export type MilestoneState = "first" | "after" | null;

/** "first" on the milestone month (strong highlight), "after" for later months (light tint). */
export function milestoneState(rowIndex: number, milestoneIndex: number | null): MilestoneState {
  if (milestoneIndex === null || rowIndex < milestoneIndex) return null;
  return rowIndex === milestoneIndex ? "first" : "after";
}
