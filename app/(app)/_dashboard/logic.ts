/** Pure helpers for the dashboard: chart series (cents → euros), summaries and gap tones. */
import { type Cents, type PlanMonth, GAP_TOLERANCE, centsToEuros } from "@/lib/engine";
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
