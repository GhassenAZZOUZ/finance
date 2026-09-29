/** Pure helpers for the dashboard: chart series (cents → euros), summaries and gap tones. */
import { PRIMARY_GOAL_ID,
  type ActualComparison,
  type Cents,
  type PlanInput,
  type PlanKpis,
  type PlanMonth,
  type PlanResult,
  type YearMonth,
  GAP_TOLERANCE,
  addMonths,
  centsToEuros,
  compareMonths,
  latestActual,
  monthsBetween,
  roundHalfAwayFromZero,
  simulatePlan,
} from "@/lib/engine";
import { formatEuros, formatEurosWhole, formatMonthLong, formatMonthShort } from "@/lib/format";

export type DebtSavingsPoint = {
  month: string;
  label: string;
  debt: number;
  freeSavings: number;
};

export type FundsPoint = {
  month: string;
  label: string;
  moving: number;
  emergency: number;
  movingGoal: number;
  emergencyTarget: number;
};

/** Chart (a): remaining debt vs cumulative free savings, in euros. */
export function debtSavingsSeries(months: readonly PlanMonth[], count = 24): DebtSavingsPoint[] {
  return months.slice(0, count).map((m) => ({
    month: m.month,
    label: formatMonthShort(m.month),
    debt: centsToEuros(m.remainingDebt),
    freeSavings: centsToEuros(m.freeSavingsCumulative),
  }));
}

/** Chart (b): both funds against their (constant) targets, in euros. */
export function fundsSeries(
  months: readonly PlanMonth[],
  movingGoal: Cents,
  emergencyTarget: Cents,
  count = 12,
): FundsPoint[] {
  return months.slice(0, count).map((m) => ({
    month: m.month,
    label: formatMonthShort(m.month),
    moving: centsToEuros(m.movingCumulative),
    emergency: centsToEuros(m.emergencyCumulative),
    movingGoal: centsToEuros(movingGoal),
    emergencyTarget: centsToEuros(emergencyTarget),
  }));
}

function range(months: readonly [PlanMonth, ...PlanMonth[]], pick: (m: PlanMonth) => Cents): string {
  const first = months[0];
  const last = months[months.length - 1] ?? first;
  return `de ${formatEurosWhole(pick(first))} en ${formatMonthLong(first.month)} à ${formatEurosWhole(pick(last))} en ${formatMonthLong(last.month)}`;
}

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

/** Text alternative for chart (a). */
export function debtSavingsSummary(months: readonly PlanMonth[], count = 24): string {
  const slice = months.slice(0, count);
  if (!isNonEmpty(slice)) return "Aucune donnée.";
  return (
    `Évolution sur ${slice.length} mois. Dette restante : ${range(slice, (m) => m.remainingDebt)}. ` +
    `Épargne libre cumulée : ${range(slice, (m) => m.freeSavingsCumulative)}.`
  );
}

/** Text alternative for chart (b). */
export function fundsSummary(
  months: readonly PlanMonth[],
  movingGoal: Cents,
  emergencyTarget: Cents,
  count = 12,
  goals = GOALS_BUCKET,
): string {
  const slice = months.slice(0, count);
  if (!isNonEmpty(slice)) return "Aucune donnée.";
  return (
    `Évolution sur ${slice.length} mois. ${goals} : ${range(slice, (m) => m.movingCumulative)}, ` +
    `objectif ${formatEurosWhole(movingGoal)}. Fonds d'urgence : ${range(slice, (m) => m.emergencyCumulative)}, ` +
    `objectif ${formatEurosWhole(emergencyTarget)}.`
  );
}

export type GapTone = "good" | "bad";

/** Debt gap (actual − planned) is good when ≤ +10 € (inclusive, SPEC §8.2). */
export function debtGapTone(gap: Cents | null): GapTone | null {
  if (gap === null) return null;
  return gap <= GAP_TOLERANCE ? "good" : "bad";
}

/** Savings gap (actual − planned) is good when ≥ −10 € (inclusive, SPEC §8.2). */
export function savingsGapTone(gap: Cents | null): GapTone | null {
  if (gap === null) return null;
  return gap >= -GAP_TOLERANCE ? "good" : "bad";
}

/** "+12,00 €" / "-3,50 €" / "0,00 €". */
export function formatSignedEuros(cents: Cents): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

export type ActualVsPlannedPoint = {
  month: string;
  label: string;
  plannedDebt: number | null;
  actualDebt: number | null;
  plannedSavings: number | null;
  actualSavings: number | null;
};

/**
 * Issue #4: every month from the first to the last check-in, in euros. Months without a check-in
 * (or outside the plan) are null so the lines break instead of dropping to 0.
 */
export function actualVsPlannedSeries(comparisons: readonly ActualComparison[]): ActualVsPlannedPoint[] {
  const byMonth = new Map(comparisons.map((c) => [c.month, c]));
  const sorted = [...byMonth.keys()].sort((a, b) => compareMonths(a, b));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return [];
  const toEuros = (v: Cents | null | undefined) => (v === null || v === undefined ? null : centsToEuros(v));
  const points: ActualVsPlannedPoint[] = [];
  for (let month = first; compareMonths(month, last) <= 0; month = addMonths(month, 1)) {
    const c = byMonth.get(month);
    points.push({
      month,
      label: formatMonthShort(month),
      plannedDebt: toEuros(c?.plannedDebt),
      actualDebt: c ? centsToEuros(c.actualDebt) : null,
      plannedSavings: toEuros(c?.plannedSavings),
      actualSavings: c ? centsToEuros(c.actualSavings) : null,
    });
  }
  return points;
}

/** Text alternative for the actual-vs-planned charts (issue #4). */
export function actualVsPlannedSummary(comparisons: readonly ActualComparison[], what: "debt" | "savings"): string {
  const latest = latestActual(comparisons);
  if (!latest) return "Aucun mois de suivi saisi.";
  const actual = what === "debt" ? latest.actualDebt : latest.actualSavings;
  const planned = what === "debt" ? latest.plannedDebt : latest.plannedSavings;
  const noun = what === "debt" ? "Dettes" : "Épargne";
  const count = comparisons.length;
  const plannedText = planned === null ? "hors période du plan" : `prévu ${formatEuros(planned)}`;
  return `${noun} réelles et prévues sur ${count} mois de suivi. Dernier mois, ${formatMonthLong(latest.month)} : réel ${formatEuros(actual)}, ${plannedText}.`;
}

/* ------------------------------------------------------------------------------------------------
 * Redesigned dashboard (docs/design/Main.dc.html): headline, moving-fund fixes, roadmap, strips.
 * ---------------------------------------------------------------------------------------------- */

/** Row of the plan for a calendar month, or undefined outside the simulated months. */
export function planMonthAt(result: PlanResult, startMonth: YearMonth, month: YearMonth): PlanMonth | undefined {
  const offset = monthsBetween(startMonth, month);
  return offset >= 0 ? result.months[offset] : undefined;
}

/** One sentence per fact: debt-free month, then whether the moving fund holds (docs/design §3). */
export function dashboardHeadline(k: PlanKpis): string {
  const parts: string[] = [];
  if (!k.hasDebt) parts.push("Aucune dette en cours.");
  else if (k.debtFreeMonth) parts.push(`Plus de dettes en ${formatMonthLong(k.debtFreeMonth)}.`);
  else parts.push("Dettes remboursées au-delà de 25 ans.");
  if (k.movingGoal > 0) {
    const several = k.goals.length > 1;
    const subject = several ? "Les objectifs d’épargne" : `« ${goalsName(k)} »`;
    parts.push(
      k.movingGoalMet
        ? `${subject} ${several ? "sont financés" : "est financé"}.`
        : `${subject} ${several ? "demandent" : "demande"} un ajustement.`,
    );
  }
  if (k.negativeBudgetMonths > 0) {
    parts.push(`${k.negativeBudgetMonths} mois en budget négatif à corriger.`);
  }
  return parts.join(" ");
}

/**
 * Months saved on the debt-free date thanks to early repayment: the last payoff without the plan
 * minus the debt-free month. Null when either date is beyond the horizon or there is no debt.
 */
export function monthsGained(result: PlanResult): number | null {
  const { debtFreeMonth, hasDebt } = result.kpis;
  if (!hasDebt || !debtFreeMonth || result.loans.length === 0) return null;
  let baseline: YearMonth | null = null;
  for (const loan of result.loans) {
    if (!loan.payoffMonthWithoutPlan) return null;
    if (!baseline || compareMonths(loan.payoffMonthWithoutPlan, baseline) > 0) baseline = loan.payoffMonthWithoutPlan;
  }
  return baseline ? monthsBetween(debtFreeMonth, baseline) : null;
}

export interface MovingShortfall {
  goal: Cents;
  amountAtDeadline: Cents;
  /** goal − amountAtDeadline, > 0. */
  shortfall: Cents;
  deadlineMonth: YearMonth;
  /** From the reference month to the deadline, inclusive; 0 when the deadline is already past. */
  monthsLeft: number;
  /** Extra saving needed per remaining month (cents, rounded); null when no month is left. */
  extraPerMonth: Cents | null;
  /** First later deadline (up to DEADLINE_TRIES months later) at which the goal is met, or null. */
  deadlineThatWorks: YearMonth | null;
}

/** Later deadlines tried to find one that works. */
export const DEADLINE_TRIES = 12;

/**
 * Two ways to fix a moving fund that misses its goal (docs/design §5): save `extraPerMonth` more
 * until the deadline, or move the deadline to `deadlineThatWorks` (found by re-simulating the plan
 * with later deadlines; the engine itself is untouched). Null when the goal is met or there is none.
 */
export function movingShortfallOptions(input: PlanInput, result: PlanResult, referenceMonth: YearMonth): MovingShortfall | null {
  const k = result.kpis;
  const shortfall = k.movingGoal - k.movingAmountAtDeadline;
  if (k.movingGoal <= 0 || k.movingGoalMet || shortfall <= 0) return null;
  const deadlineMonth = input.budget.movingDeadlineMonth;
  const monthsLeft = Math.max(0, monthsBetween(referenceMonth, deadlineMonth) + 1);
  let deadlineThatWorks: YearMonth | null = null;
  for (let i = 1; i <= DEADLINE_TRIES && !deadlineThatWorks; i++) {
    const later = addMonths(deadlineMonth, i);
    const next = simulatePlan({ ...input, budget: { ...input.budget, movingDeadlineMonth: later } });
    if (next.kpis.movingGoalMet) deadlineThatWorks = later;
  }
  return {
    goal: k.movingGoal,
    amountAtDeadline: k.movingAmountAtDeadline,
    shortfall,
    deadlineMonth,
    monthsLeft,
    extraPerMonth: monthsLeft > 0 ? roundHalfAwayFromZero(shortfall / monthsLeft) : null,
    deadlineThatWorks,
  };
}

/** Allocation phase of a month: which bucket receives the money available that month. */
export type PhaseKind = "moving" | "emergency" | "repay" | "free";

/** The savings-goals bucket in general (SPEC D23). */
export const GOALS_BUCKET = "Objectifs d’épargne";

/** Name of the savings-goals bucket: the only goal's name, « Objectifs » when there are several (SPEC D23). */
export function goalsName(kpis: Pick<PlanKpis, "goals">): string {
  return kpis.goals.length === 1 ? (kpis.goals[0]?.name ?? GOALS_BUCKET) : kpis.goals.length > 1 ? "Objectifs" : GOALS_BUCKET;
}

/** The bucket in a sentence: « Voyage » for a single goal, « les objectifs d’épargne » otherwise. */
export function goalsPhrase(kpis: Pick<PlanKpis, "goals">): string {
  return kpis.goals.length === 1 ? `« ${goalsName(kpis)} »` : "les objectifs d’épargne";
}

/** Name of the primary goal. */
export function primaryGoalName(kpis: Pick<PlanKpis, "goals">): string {
  return kpis.goals.find((g) => g.id === PRIMARY_GOAL_ID)?.name ?? "Objectif principal";
}

/** "① Voyage", "② Fonds d’urgence", "③ Remb. anticipé + épargne", "④ Épargne libre". */
export function phaseLabel(kind: PhaseKind, earlyRepaymentPct: number, goals = GOALS_BUCKET): string {
  if (kind === "moving") return `① ${goals}`;
  if (kind === "emergency") return "② Fonds d’urgence";
  if (kind === "repay") return earlyRepaymentPct > 0 ? "③ Remb. anticipé + épargne" : "③ Épargne libre, crédits en cours";
  return "④ Épargne libre";
}

export interface PlanPhase {
  kind: PhaseKind;
  /** 1-based plan month indexes, inclusive. */
  startIndex: number;
  endIndex: number;
  startMonth: YearMonth;
  endMonth: YearMonth;
}

/**
 * The plan cut into consecutive phases (moving → emergency → early repayment + free savings →
 * free savings). A month without money available (negative budget) keeps the previous phase.
 */
export function planPhases(months: readonly PlanMonth[]): PlanPhase[] {
  const phases: PlanPhase[] = [];
  let previous: PhaseKind = "moving";
  for (const m of months) {
    let kind: PhaseKind;
    if (m.available <= 0) kind = previous;
    else if (m.toMoving > 0) kind = "moving";
    else if (m.toEmergency > 0) kind = "emergency";
    // Once the debts are gone the early-repayment share is "unused" and goes to free savings.
    else if (m.remainingDebt > 0 || m.toEarlyRepayment - m.unusedEarlyRepayment > 0) kind = "repay";
    else kind = "free";
    previous = kind;
    const last = phases.at(-1);
    if (last && last.kind === kind) {
      last.endIndex = m.index;
      last.endMonth = m.month;
    } else {
      phases.push({ kind, startIndex: m.index, endIndex: m.index, startMonth: m.month, endMonth: m.month });
    }
  }
  return phases;
}

export type RoadmapEventKind = "loanPaidOff" | "deadline" | "emergencyReached" | "debtFree" | "freeSavings";

export interface RoadmapEvent {
  kind: RoadmapEventKind;
  /** 1-based plan month. */
  index: number;
  month: YearMonth;
  text: string;
  /** "warning" = moving deadline missed; "strong" = debt-free. */
  tone?: "warning" | "strong";
  /** Shown after the month ("date limite", "→"). */
  monthSuffix?: string;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

/** Milestones listed under the roadmap, in month order (docs/design §3 Dashboard 4). */
export function roadmapEvents(input: PlanInput, result: PlanResult): RoadmapEvent[] {
  const { months, kpis } = result;
  const { budget } = input;
  const events: RoadmapEvent[] = [];
  const indexOf = (month: YearMonth) => {
    const offset = monthsBetween(budget.startMonth, month);
    return offset >= 0 && offset < months.length ? offset + 1 : null;
  };

  const payoffs = new Map<number, string[]>();
  for (const loan of result.loans) {
    // An overdraft is reusable: clearing it is not a payoff milestone (SPEC D24).
    const index = loan.payoffMonthWithPlan && loan.kind !== "overdraft" ? indexOf(loan.payoffMonthWithPlan) : null;
    // Loans already repaid at the start (month 1) are not milestones.
    if (index === null || index === 1) continue;
    payoffs.set(index, [...(payoffs.get(index) ?? []), loan.displayName]);
  }
  const debtFreeIndex = kpis.hasDebt && kpis.debtFreeMonth ? indexOf(kpis.debtFreeMonth) : null;
  for (const [index, names] of payoffs) {
    const month = months[index - 1]!.month;
    const verb = names.length > 1 ? "soldés" : "soldé";
    if (index === debtFreeIndex) {
      events.push({ kind: "debtFree", index, month, text: `${joinNames(names)} ${verb} · plus de dettes`, tone: "strong" });
    } else {
      events.push({ kind: "loanPaidOff", index, month, text: `${joinNames(names)} ${verb}` });
    }
  }
  if (debtFreeIndex !== null && !payoffs.has(debtFreeIndex)) {
    events.push({ kind: "debtFree", index: debtFreeIndex, month: kpis.debtFreeMonth!, text: "Plus de dettes", tone: "strong" });
  }

  const deadlineIndex = budget.movingGoal > 0 ? indexOf(budget.movingDeadlineMonth) : null;
  if (deadlineIndex !== null) {
    events.push({
      kind: "deadline",
      index: deadlineIndex,
      month: budget.movingDeadlineMonth,
      monthSuffix: "date limite",
      text: kpis.movingGoalMet
        ? `${primaryGoalName(kpis)} financé (${formatEurosWhole(kpis.movingGoal)})`
        : `${primaryGoalName(kpis)} : ${formatEuros(kpis.movingAmountAtDeadline)} sur ${formatEurosWhole(kpis.movingGoal)}`,
      tone: kpis.movingGoalMet ? undefined : "warning",
    });
  }

  const emergencyIndex =
    budget.emergencyTarget > 0 && kpis.emergencyReachedMonth ? indexOf(kpis.emergencyReachedMonth) : null;
  if (emergencyIndex !== null && emergencyIndex > 1) {
    events.push({
      kind: "emergencyReached",
      index: emergencyIndex,
      month: kpis.emergencyReachedMonth!,
      text: `Fonds d’urgence complet (${formatEurosWhole(kpis.emergencyTarget)})`,
    });
  }

  if (debtFreeIndex !== null) {
    const after = months[debtFreeIndex];
    if (after && after.toFreeSavings > 0) {
      events.push({
        kind: "freeSavings",
        index: after.index,
        month: after.month,
        monthSuffix: "→",
        text: `${formatEurosWhole(after.toFreeSavings)} / mois en épargne libre`,
      });
    }
  }

  const order: RoadmapEventKind[] = ["loanPaidOff", "deadline", "emergencyReached", "debtFree", "freeSavings"];
  return events.sort((a, b) => a.index - b.index || order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** Months drawn on the roadmap band: up to 6 months past the last milestone, 18 to `total` months. */
export function roadmapWindow(events: readonly RoadmapEvent[], referenceIndex: number, total: number): number {
  const last = Math.max(referenceIndex, ...events.filter((e) => e.kind !== "freeSavings").map((e) => e.index));
  return Math.min(total, Math.max(18, last + 6));
}

export type CheckInSlotState = "entered" | "pending" | "current";

export interface CheckInSlot {
  month: YearMonth;
  state: CheckInSlotState;
  comparison: ActualComparison | null;
}

/**
 * The last `count` months open to a check-in (up to the current month), oldest first: entered
 * (with its comparison), pending (past, not entered) or current (not entered, still running).
 */
export function checkInStrip(
  startMonth: YearMonth,
  currentMonth: YearMonth,
  comparisons: readonly ActualComparison[],
  count = 3,
): CheckInSlot[] {
  if (compareMonths(startMonth, currentMonth) > 0) return [];
  const byMonth = new Map(comparisons.map((c) => [c.month, c]));
  const slots: CheckInSlot[] = [];
  const open = Math.min(count, monthsBetween(startMonth, currentMonth) + 1);
  for (let i = open - 1; i >= 0; i--) {
    const month = addMonths(currentMonth, -i);
    const comparison = byMonth.get(month) ?? null;
    slots.push({ month, comparison, state: comparison ? "entered" : month === currentMonth ? "current" : "pending" });
  }
  return slots;
}
