/**
 * Savings deposits (issue #73, SPEC D33): each check-in records what was put into (or taken out of)
 * each savings pot that month; the pots' balances are computed, never typed. A month without a
 * check-in counts the deposit the plan planned for it. Pure functions, shared by the page and the
 * server action.
 */
import { type Cents, type PlanResult, type YearMonth, PRIMARY_GOAL_ID, addMonths, compareMonths, monthsBetween } from "@/lib/engine";
import type { BudgetSettings, MonthlyActual, SavingsGoal } from "./types";

export type PotKind = "goal" | "emergency" | "free";

/** One pot's movement in a check-in; a withdrawal is negative. */
export interface SavingsDeposit {
  pot: PotKind;
  /** The goal (null for the emergency fund and free savings, and once the goal is deleted). */
  goalId: string | null;
  /** The goal's name at save time (kept when the goal is deleted). */
  goalName: string | null;
  /** What the plan planned for that pot that month, at save time. */
  planned: Cents;
  amount: Cents;
}

/** Balance of each pot at the end of a month. */
export interface PotBalances {
  goals: Record<string, Cents>;
  emergency: Cents;
  free: Cents;
}

type Goals = readonly Pick<SavingsGoal, "id" | "primary" | "alreadySaved">[];
type Starts = Pick<BudgetSettings, "startMonth" | "emergencyExisting" | "freeSavingsExisting">;

export function startingBalances(settings: Starts, goals: Goals): PotBalances {
  return {
    goals: Object.fromEntries(goals.map((g) => [g.id, g.alreadySaved])),
    emergency: settings.emergencyExisting,
    free: settings.freeSavingsExisting ?? 0,
  };
}

/** The plan's balances at the end of `month`: the starting amounts before the plan, the last month after it. */
export function plannedBalances(result: PlanResult, settings: Starts, goals: Goals, month: YearMonth): PotBalances {
  const offset = monthsBetween(settings.startMonth, month);
  if (offset < 0 || result.months.length === 0) return startingBalances(settings, goals);
  const planMonth = result.months[Math.min(offset, result.months.length - 1)]!;
  const index = new Map(result.kpis.goals.map((g, i) => [g.id, i]));
  return {
    goals: Object.fromEntries(
      goals.map((g) => {
        const i = index.get(g.primary ? PRIMARY_GOAL_ID : g.id);
        const cumulative = i === undefined ? (g.primary ? planMonth.movingCumulative : g.alreadySaved) : (planMonth.goals[i]?.cumulative ?? 0);
        return [g.id, cumulative];
      }),
    ),
    emergency: planMonth.emergencyCumulative,
    free: planMonth.freeSavingsCumulative,
  };
}

/**
 * The deposit the plan plans for each pot in `month`: its planned balance minus the month before's
 * (so a December includes the credited interest, D28, and free savings the extra repayments, D17).
 */
export function plannedDeposits(result: PlanResult, settings: Starts, goals: Goals, month: YearMonth): PotBalances {
  const now = plannedBalances(result, settings, goals, month);
  const before = plannedBalances(result, settings, goals, addMonths(month, -1));
  if (compareMonths(month, settings.startMonth) < 0 || monthsBetween(settings.startMonth, month) >= result.months.length) {
    return { goals: Object.fromEntries(goals.map((g) => [g.id, 0])), emergency: 0, free: 0 };
  }
  return {
    goals: Object.fromEntries(goals.map((g) => [g.id, now.goals[g.id]! - before.goals[g.id]!])),
    emergency: now.emergency - before.emergency,
    free: now.free - before.free,
  };
}

/** A check-in saved before deposits existed: its typed balances are kept as they are (issue #73 AC-06). */
export function hasTypedBalances(actual: Pick<MonthlyActual, "deposits">): boolean {
  return !actual.deposits || actual.deposits.length === 0;
}

/**
 * Balances at the end of every month from the plan start to `until` (SPEC D33): the starting amounts,
 * plus each month's deposits (the check-in's, else the plan's). A check-in without deposits (typed
 * balances, before #73) sets the balances to its typed ones.
 */
export function balancesByMonth(
  result: PlanResult,
  settings: Starts,
  goals: Goals,
  actuals: readonly MonthlyActual[],
  until: YearMonth,
): Map<YearMonth, PotBalances> {
  const byMonth = new Map(actuals.map((a) => [a.month, a]));
  const out = new Map<YearMonth, PotBalances>();
  let running = startingBalances(settings, goals);
  for (let month = settings.startMonth; compareMonths(month, until) <= 0; month = addMonths(month, 1)) {
    const actual = byMonth.get(month);
    const planned = plannedDeposits(result, settings, goals, month);
    if (actual && hasTypedBalances(actual)) {
      const typed = new Map(actual.goalBalances.map((b) => [b.goalId, b.balance]));
      running = {
        goals: Object.fromEntries(goals.map((g) => [g.id, typed.get(g.id) ?? running.goals[g.id]! + planned.goals[g.id]!])),
        emergency: actual.emergencySavings,
        free: actual.freeSavings,
      };
    } else {
      const deposit = (pot: PotKind, goalId: string | null, plannedAmount: Cents) =>
        actual?.deposits?.find((d) => d.pot === pot && (pot !== "goal" || d.goalId === goalId))?.amount ?? plannedAmount;
      running = {
        goals: Object.fromEntries(goals.map((g) => [g.id, running.goals[g.id]! + deposit("goal", g.id, planned.goals[g.id]!)])),
        emergency: running.emergency + deposit("emergency", null, planned.emergency),
        free: running.free + deposit("free", null, planned.free),
      };
    }
    out.set(month, running);
  }
  return out;
}

/** Months from the plan start to `month` (excluded) without a check-in: their planned deposits were counted. */
export function monthsNotEntered(settings: Pick<BudgetSettings, "startMonth">, actuals: readonly Pick<MonthlyActual, "month">[], month: YearMonth): YearMonth[] {
  const entered = new Set(actuals.map((a) => a.month));
  const out: YearMonth[] = [];
  for (let m = settings.startMonth; compareMonths(m, month) < 0; m = addMonths(m, 1)) if (!entered.has(m)) out.push(m);
  return out;
}

/**
 * The check-ins with their computed balances (SPEC D33): `emergencySavings`, `freeSavings` and
 * `goalBalances` become the computed end-of-month balances, so every reader (comparison §8.2,
 * dashboard, re-base, goals' progress) uses them. Check-ins before the plan start are left as they are.
 */
export function withComputedBalances(
  result: PlanResult,
  settings: Starts,
  goals: Goals,
  actuals: readonly MonthlyActual[],
): MonthlyActual[] {
  const last = actuals.map((a) => a.month).sort().at(-1);
  if (!last || compareMonths(last, settings.startMonth) < 0) return [...actuals];
  const balances = balancesByMonth(result, settings, goals, actuals, last);
  return actuals.map((a) => {
    const b = balances.get(a.month);
    if (!b) return a;
    return {
      ...a,
      emergencySavings: b.emergency,
      freeSavings: b.free,
      goalBalances: goals.map((g) => ({ goalId: g.id, balance: b.goals[g.id]! })),
    };
  });
}
