/**
 * Savings deposits (issue #73, SPEC D33): each check-in records what was put into (or taken out of)
 * each savings pot that month; the pots' balances are computed, never typed. A month without a
 * check-in counts the deposit the plan planned for it. The computed balances earn interest with the
 * plan's rule (issue #82, D28), so nothing about interest is typed. Pure functions, shared by the
 * page and the server action.
 */
import {
  type Cents,
  type PlanMonth,
  type PlanResult,
  type YearMonth,
  PRIMARY_GOAL_ID,
  addMonths,
  compareMonths,
  monthsBetween,
  roundHalfAwayFromZero,
} from "@/lib/engine";
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
  /** Interest credited that month, all pots together (December and the plan's last month, D28). */
  interest?: Cents;
}

type Goals = readonly Pick<SavingsGoal, "id" | "primary" | "alreadySaved" | "rate">[];
type Starts = Pick<
  BudgetSettings,
  "startMonth" | "emergencyExisting" | "freeSavingsExisting" | "emergencyTarget" | "emergencyRate" | "freeSavingsRate"
>;

/** Monthly interest in cents, the engine's rounding: ROUND(balance × rate / 12, 2) (SPEC §4.0, D28). */
const monthlyInterest = (balance: Cents, rate: number | undefined): Cents => roundHalfAwayFromZero((balance * (rate ?? 0)) / 12);

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

/** The plan's month for `month`, or undefined outside the plan. */
function planMonthOf(result: PlanResult, settings: Pick<Starts, "startMonth">, month: YearMonth): PlanMonth | undefined {
  const offset = monthsBetween(settings.startMonth, month);
  return offset < 0 ? undefined : result.months[offset];
}

/**
 * The deposit the plan plans for each pot in `month`: its planned balance minus the month before's,
 * without the interest the plan credits that month (issue #82: the computed balances add it
 * themselves); free savings keep the extra repayments taken from them (D17).
 */
export function plannedDeposits(result: PlanResult, settings: Starts, goals: Goals, month: YearMonth): PotBalances {
  const planMonth = planMonthOf(result, settings, month);
  if (!planMonth) return { goals: Object.fromEntries(goals.map((g) => [g.id, 0])), emergency: 0, free: 0 };
  const now = plannedBalances(result, settings, goals, month);
  const before = plannedBalances(result, settings, goals, addMonths(month, -1));
  const index = new Map(result.kpis.goals.map((g, i) => [g.id, i]));
  const goalInterest = (g: Goals[number]) => {
    const i = index.get(g.primary ? PRIMARY_GOAL_ID : g.id);
    return i === undefined ? 0 : (planMonth.goals[i]?.interest ?? 0);
  };
  return {
    goals: Object.fromEntries(goals.map((g) => [g.id, now.goals[g.id]! - before.goals[g.id]! - goalInterest(g)])),
    emergency: now.emergency - before.emergency - planMonth.emergencyInterest,
    free: now.free - before.free - planMonth.freeSavingsInterest,
  };
}

/** A check-in saved before deposits existed: its typed balances are kept as they are (issue #73 AC-06). */
export function hasTypedBalances(actual: Pick<MonthlyActual, "deposits">): boolean {
  return !actual.deposits || actual.deposits.length === 0;
}

/**
 * Balances at the end of every month from the plan start to `until` (SPEC D33): the starting amounts,
 * plus each month's deposits (the check-in's, else the plan's), plus the interest of the plan's rule
 * (issue #82, D28): accrued each month on the balances at its start, credited after December's
 * deposits and in the plan's last month, the emergency fund's above its target going to free
 * savings. Depositing exactly the plan gives exactly the plan's balances. A check-in without deposits
 * (typed balances, before #73) sets the balances to its typed ones, interest included.
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
  // Interest accrued since the last crediting, per pot (D28).
  let accrued = { goals: Object.fromEntries(goals.map((g) => [g.id, 0])) as Record<string, Cents>, emergency: 0, free: 0 };
  const lastPlanMonth = addMonths(settings.startMonth, result.months.length - 1);
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
      // A typed balance already includes whatever interest the bank credited.
      accrued = { goals: Object.fromEntries(goals.map((g) => [g.id, 0])), emergency: 0, free: 0 };
    } else {
      // Interest of the month, on the balances at its start.
      accrued = {
        goals: Object.fromEntries(goals.map((g) => [g.id, accrued.goals[g.id]! + monthlyInterest(running.goals[g.id]!, g.rate)])),
        emergency: accrued.emergency + monthlyInterest(running.emergency, settings.emergencyRate),
        free: accrued.free + monthlyInterest(running.free, settings.freeSavingsRate),
      };
      const deposit = (pot: PotKind, goalId: string | null, plannedAmount: Cents) =>
        actual?.deposits?.find((d) => d.pot === pot && (pot !== "goal" || d.goalId === goalId))?.amount ?? plannedAmount;
      const toEmergency = deposit("emergency", null, planned.emergency);
      const next: PotBalances = {
        goals: Object.fromEntries(goals.map((g) => [g.id, running.goals[g.id]! + deposit("goal", g.id, planned.goals[g.id]!)])),
        emergency: running.emergency + toEmergency,
        free: running.free + deposit("free", null, planned.free),
        interest: 0,
      };
      if (month.endsWith("-12") || month === lastPlanMonth) {
        // The emergency fund's interest fills it up to its target; the rest goes to free savings (D28).
        const emergencyInterest = Math.min(accrued.emergency, Math.max(0, settings.emergencyTarget - running.emergency - toEmergency));
        const goalsInterest = goals.reduce((sum, g) => sum + accrued.goals[g.id]!, 0);
        for (const g of goals) next.goals[g.id] = next.goals[g.id]! + accrued.goals[g.id]!;
        next.emergency += emergencyInterest;
        next.free += accrued.free + accrued.emergency - emergencyInterest;
        next.interest = goalsInterest + accrued.emergency + accrued.free;
        accrued = { goals: Object.fromEntries(goals.map((g) => [g.id, 0])), emergency: 0, free: 0 };
      }
      running = next;
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
