/** Pure helpers for the dashboard: chart series (cents → euros), summaries and gap tones. */
import {
  type ActualComparison,
  type Cents,
  type PlanMonth,
  GAP_TOLERANCE,
  addMonths,
  centsToEuros,
  compareMonths,
  latestActual,
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
export function fundsSummary(months: readonly PlanMonth[], movingGoal: Cents, emergencyTarget: Cents, count = 12): string {
  const slice = months.slice(0, count);
  if (!isNonEmpty(slice)) return "Aucune donnée.";
  return (
    `Évolution sur ${slice.length} mois. Fonds déménagement : ${range(slice, (m) => m.movingCumulative)}, ` +
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
