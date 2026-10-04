/**
 * Series and text alternatives of the dashboard charts added by issues #86–#92 (cents → euros).
 * Pure helpers: the components only lay them out.
 */
import type { MonthlyActual } from "@/lib/domain/types";
import {
  type ActualComparison,
  type Cents,
  type LoanSummary,
  type PlanKpis,
  type PlanMonth,
  type YearMonth,
  addMonths,
  centsToEuros,
  compareMonths,
  sumCents,
} from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort } from "@/lib/format";
import { debtGapTone, formatSignedEuros, savingsGapTone, type GapTone } from "./logic";

/** Months shown by the plan charts of the tabbed card (same window as « Dettes et épargne »). */
export const PLAN_CHART_MONTHS = 24;

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

/* ---------------------------------------------- #86 Funds ---------------------------------------------- */

/** Σ of the goals' targets: the target of `movingCumulative` (SPEC D23). */
export function goalsTarget(kpis: Pick<PlanKpis, "goals">): Cents {
  return sumCents(kpis.goals.map((g) => g.target));
}

/* -------------------------------------------- #90 Net worth -------------------------------------------- */

/** Savings (goals + emergency fund + free savings) minus the remaining debt. */
export function netWorthOf(m: PlanMonth): Cents {
  return m.movingCumulative + m.emergencyCumulative + m.freeSavingsCumulative - m.remainingDebt;
}

export type NetWorthPoint = { month: YearMonth; label: string; planned: number; actual: number | null };

/** Planned net worth per month, and the actual one (check-ins: savings − debt) where a month was entered. */
export function netWorthSeries(
  months: readonly PlanMonth[],
  comparisons: readonly ActualComparison[],
  count = PLAN_CHART_MONTHS,
): NetWorthPoint[] {
  const actual = new Map(comparisons.map((c) => [c.month, c.actualSavings - c.actualDebt]));
  return months.slice(0, count).map((m) => {
    const real = actual.get(m.month);
    return {
      month: m.month,
      label: formatMonthShort(m.month),
      planned: centsToEuros(netWorthOf(m)),
      actual: real === undefined ? null : centsToEuros(real),
    };
  });
}

export type NetWorthCrossing =
  | { kind: "alreadyPositive"; month: YearMonth }
  | { kind: "crosses"; month: YearMonth }
  | { kind: "never" };

/** When the planned net worth turns positive, over the whole plan. */
export function netWorthCrossing(months: readonly PlanMonth[]): NetWorthCrossing {
  const first = months[0];
  if (!first) return { kind: "never" };
  if (netWorthOf(first) >= 0) return { kind: "alreadyPositive", month: first.month };
  const turn = months.find((m) => netWorthOf(m) >= 0);
  return turn ? { kind: "crosses", month: turn.month } : { kind: "never" };
}

export function netWorthCrossingText(crossing: NetWorthCrossing): string {
  if (crossing.kind === "alreadyPositive") return `Patrimoine positif dès ${formatMonthLong(crossing.month)}.`;
  if (crossing.kind === "crosses") return `Patrimoine positif en ${formatMonthLong(crossing.month)}.`;
  return "Patrimoine négatif sur toute la durée du plan.";
}

export function netWorthSummary(
  months: readonly PlanMonth[],
  comparisons: readonly ActualComparison[],
  count = PLAN_CHART_MONTHS,
): string {
  const slice = months.slice(0, count);
  const first = slice[0];
  const end = last(slice);
  if (!first || !end) return "Aucune donnée.";
  let text =
    `Patrimoine net (épargne moins dettes) sur ${slice.length} mois : de ${formatEuros(netWorthOf(first))} en ` +
    `${formatMonthLong(first.month)} à ${formatEuros(netWorthOf(end))} en ${formatMonthLong(end.month)}. ` +
    netWorthCrossingText(netWorthCrossing(months));
  const latest = [...comparisons].sort((a, b) => compareMonths(a.month, b.month)).at(-1);
  if (latest) text += ` Réel en ${formatMonthLong(latest.month)} : ${formatEuros(latest.actualSavings - latest.actualDebt)}.`;
  return text;
}

/* -------------------------------------------- #89 Interest --------------------------------------------- */

export type InterestPoint = { month: YearMonth; label: string; withPlan: number; withoutPlan: number };

/**
 * Cumulative loan interest with the plan (penalties included, so the gap is « intérêts économisés »,
 * SPEC D22) and without it.
 */
export function interestSeries(months: readonly PlanMonth[], count = PLAN_CHART_MONTHS): InterestPoint[] {
  let withPlan = 0;
  let withoutPlan = 0;
  return months.slice(0, count).map((m) => {
    withPlan += m.totalInterest + m.totalPenalty;
    withoutPlan += m.totalBaselineInterest;
    return { month: m.month, label: formatMonthShort(m.month), withPlan: centsToEuros(withPlan), withoutPlan: centsToEuros(withoutPlan) };
  });
}

export function interestSummary(months: readonly PlanMonth[], count = PLAN_CHART_MONTHS): string {
  const slice = months.slice(0, count);
  const end = last(slice);
  if (!end) return "Aucune donnée.";
  const withPlan = sumCents(slice.map((m) => m.totalInterest + m.totalPenalty));
  const withoutPlan = sumCents(slice.map((m) => m.totalBaselineInterest));
  return (
    `Intérêts cumulés sur ${slice.length} mois, jusqu’en ${formatMonthLong(end.month)} : ${formatEuros(withPlan)} avec le plan ` +
    `(pénalités comprises), ${formatEuros(withoutPlan)} sans le plan, soit ${formatEuros(withoutPlan - withPlan)} économisés.`
  );
}

/* ------------------------------------------ #88 Debt by loan ------------------------------------------- */

/** Loans with their own band; the others are folded into « Autres crédits » (one more hue would not stay readable). */
export const LOAN_BANDS = 4;
export const OTHER_LOANS_KEY = "otherLoans";

export interface LoanBand {
  key: string;
  name: string;
  /** Positions in `PlanInput.loans` / `PlanMonth.loans`. */
  loanIndexes: number[];
  /** Colour slot 0..LOAN_BANDS-1, or null for « Autres crédits ». */
  slot: number | null;
}

/** Bands in repayment order (priority 1 first, ineligible loans last), like « Ordre de remboursement ». */
export function loanBands(loans: readonly LoanSummary[]): LoanBand[] {
  const order = loans
    .map((loan, index) => ({ loan, index }))
    .sort((a, b) => (a.loan.priority ?? Infinity) - (b.loan.priority ?? Infinity) || a.index - b.index);
  const own = order.length > LOAN_BANDS ? order.slice(0, LOAN_BANDS - 1) : order;
  const bands: LoanBand[] = own.map(({ loan, index }, slot) => ({ key: `loan${index}`, name: loan.displayName, loanIndexes: [index], slot }));
  const rest = order.slice(own.length);
  if (rest.length > 0) bands.push({ key: OTHER_LOANS_KEY, name: "Autres crédits", loanIndexes: rest.map((r) => r.index), slot: null });
  return bands;
}

export type DebtByLoanPoint = { month: YearMonth; label: string; baseline: number } & Record<string, number | string>;

/** Remaining balance per band and the « sans plan » total, per month. */
export function debtByLoanSeries(months: readonly PlanMonth[], bands: readonly LoanBand[], count = PLAN_CHART_MONTHS): DebtByLoanPoint[] {
  return months.slice(0, count).map((m) => {
    const point: DebtByLoanPoint = {
      month: m.month,
      label: formatMonthShort(m.month),
      baseline: centsToEuros(sumCents(m.loans.map((l) => l.baselineEndBalance))),
    };
    for (const band of bands) point[band.key] = centsToEuros(sumCents(band.loanIndexes.map((i) => m.loans[i]?.endBalance ?? 0)));
    return point;
  });
}

/** « Prêt auto : soldé en mars 2028 » per loan, in band order. */
export function loanPayoffLines(loans: readonly LoanSummary[], bands: readonly LoanBand[]): string[] {
  return bands.flatMap((band) =>
    band.loanIndexes.map((i) => {
      const loan = loans[i]!;
      if (loan.kind === "overdraft") return `${loan.displayName} : découvert renouvelable`;
      return loan.payoffMonthWithPlan
        ? `${loan.displayName} : soldé en ${formatMonthLong(loan.payoffMonthWithPlan)}`
        : `${loan.displayName} : soldé au-delà de 25 ans`;
    }),
  );
}

export function debtByLoanSummary(months: readonly PlanMonth[], loans: readonly LoanSummary[], count = PLAN_CHART_MONTHS): string {
  const slice = months.slice(0, count);
  if (slice.length === 0 || loans.length === 0) return "Aucun crédit.";
  return `Dette restante par crédit sur ${slice.length} mois. ${loanPayoffLines(loans, loanBands(loans)).join(". ")}.`;
}

/* ------------------------------------------ #87 Income uses -------------------------------------------- */

export type IncomeUsePoint = {
  month: YearMonth;
  label: string;
  income: number;
  expenses: number;
  loanPayments: number;
  goals: number;
  emergency: number;
  earlyRepayment: number;
  freeSavings: number;
  /** ≤ 0: what is missing in a negative-budget month, drawn below zero. */
  shortfall: number;
  negative: boolean;
};

/** Where each month's income goes, `count` months from the 0-based `from` (the reference month). */
export function incomeUsesSeries(months: readonly PlanMonth[], from: number, count = 12): IncomeUsePoint[] {
  return months.slice(Math.max(0, from), Math.max(0, from) + count).map((m) => ({
    month: m.month,
    label: formatMonthShort(m.month),
    income: centsToEuros(m.income),
    expenses: centsToEuros(m.expenses),
    loanPayments: centsToEuros(m.loanPayments),
    goals: centsToEuros(m.toMoving),
    emergency: centsToEuros(m.toEmergency),
    // The unused part of the early-repayment share already went to free savings.
    earlyRepayment: centsToEuros(m.toEarlyRepayment - m.unusedEarlyRepayment),
    freeSavings: centsToEuros(m.toFreeSavings),
    shortfall: centsToEuros(Math.min(0, m.available)),
    negative: m.negativeBudget,
  }));
}

export function incomeUsesSummary(months: readonly PlanMonth[], from: number, count = 12): string {
  const slice = months.slice(Math.max(0, from), Math.max(0, from) + count);
  const first = slice[0];
  const end = last(slice);
  if (!first || !end) return "Aucune donnée.";
  const saved = (m: PlanMonth) => m.toMoving + m.toEmergency + m.toFreeSavings;
  const describe = (m: PlanMonth) =>
    `${formatMonthLong(m.month)} : ${formatEuros(m.income)} de revenus, ${formatEuros(m.expenses)} de dépenses, ` +
    `${formatEuros(m.loanPayments)} de mensualités, ${formatEuros(m.toEarlyRepayment - m.unusedEarlyRepayment)} de remboursement anticipé ` +
    `et ${formatEuros(saved(m))} d’épargne`;
  const negatives = slice.filter((m) => m.negativeBudget);
  const negativeText =
    negatives.length === 0
      ? ""
      : ` Budget négatif en ${negatives.map((m) => formatMonthLong(m.month)).join(", ")}.`;
  return `Répartition des revenus sur ${slice.length} mois. ${describe(first)}. ${describe(end)}.${negativeText}`;
}

/* --------------------------------------------- #91 Gaps ------------------------------------------------ */

export type GapPoint = { month: YearMonth; label: string; incomeGap: number | null; expensesGap: number | null };

/** Income below plan by more than 10 € is bad (SPEC §8.2), like a savings gap. */
export const incomeGapTone = savingsGapTone;
/** Expenses above plan by more than 10 € are bad (SPEC §8.2), like a debt gap. */
export const expensesGapTone = debtGapTone;

/**
 * The `count` latest check-ins with income/expense gaps, from the oldest of them to the latest:
 * months without a check-in in between are null (no bar).
 */
export function gapsSeries(comparisons: readonly ActualComparison[], count = 12): GapPoint[] {
  const withGaps = comparisons
    .filter((c) => c.incomeGap !== null || c.expensesGap !== null)
    .sort((a, b) => compareMonths(a.month, b.month))
    .slice(-count);
  const first = withGaps[0];
  const end = last(withGaps);
  if (!first || !end) return [];
  const byMonth = new Map(withGaps.map((c) => [c.month, c]));
  const points: GapPoint[] = [];
  for (let month = first.month; compareMonths(month, end.month) <= 0; month = addMonths(month, 1)) {
    const c = byMonth.get(month);
    const euros = (v: Cents | null | undefined) => (v === null || v === undefined ? null : centsToEuros(v));
    points.push({ month, label: formatMonthShort(month), incomeGap: euros(c?.incomeGap), expensesGap: euros(c?.expensesGap) });
  }
  return points;
}

export function gapsSummary(comparisons: readonly ActualComparison[], count = 12): string {
  const points = gapsSeries(comparisons, count);
  const entered = comparisons
    .filter((c) => c.incomeGap !== null || c.expensesGap !== null)
    .sort((a, b) => compareMonths(a.month, b.month))
    .slice(-count);
  const latest = last(entered);
  if (!latest || points.length === 0) return "Aucun mois de suivi détaillé.";
  const bad = entered.filter((c) => incomeGapTone(c.incomeGap) === "bad" || expensesGapTone(c.expensesGap) === "bad").length;
  const gap = (v: Cents | null) => (v === null ? "non saisi" : formatSignedEuros(v));
  return (
    `Écarts au plan sur ${entered.length} mois de suivi. Dernier mois, ${formatMonthLong(latest.month)} : revenus ${gap(latest.incomeGap)}, ` +
    `dépenses ${gap(latest.expensesGap)}. ${bad === 0 ? "Aucun mois" : `${bad} mois`} au-delà de la tolérance de 10 €.`
  );
}

/** Tone of a gap bar, or null when there is none. */
export function gapTone(key: "incomeGap" | "expensesGap", euros: number | null): GapTone | null {
  if (euros === null) return null;
  const cents = Math.round(euros * 100);
  return key === "incomeGap" ? incomeGapTone(cents) : expensesGapTone(cents);
}

/* -------------------------------------------- #92 Spending --------------------------------------------- */

export type SpendingRow = { key: string; label: string; planned: number; actual: number; gap: number };

export interface Spending {
  month: YearMonth;
  /** False for a check-in saved before the detailed rows (#72): nothing to break down. */
  detailed: boolean;
  rows: SpendingRow[];
  planned: Cents;
  actual: Cents;
}

/** Expense rows of the latest check-in (budget lines, exceptions, « hors budget »), largest overspend first. */
export function latestSpending(actuals: readonly MonthlyActual[]): Spending | null {
  const latest = [...actuals].sort((a, b) => compareMonths(a.month, b.month)).at(-1);
  if (!latest) return null;
  const expenses = latest.lines.filter((l) => l.direction === "expense" && (l.planned !== 0 || l.actual !== 0));
  const rows = expenses
    .map((l, i) => ({
      key: `${l.kind}-${l.budgetLineId ?? l.exceptionId ?? i}`,
      label: l.label,
      planned: centsToEuros(l.planned),
      actual: centsToEuros(l.actual),
      gapCents: l.actual - l.planned,
    }))
    .sort((a, b) => b.gapCents - a.gapCents || a.label.localeCompare(b.label, "fr"))
    .map(({ gapCents, ...row }) => ({ ...row, gap: centsToEuros(gapCents) }));
  return {
    month: latest.month,
    detailed: latest.lines.length > 0,
    rows,
    planned: sumCents(expenses.map((l) => l.planned)),
    actual: sumCents(expenses.map((l) => l.actual)),
  };
}

export function spendingSummary(spending: Spending): string {
  if (!spending.detailed) return `Dépenses de ${formatMonthLong(spending.month)} non détaillées.`;
  const top = spending.rows[0];
  const over = top && top.gap > 0 ? ` Plus gros dépassement : ${top.label}, ${formatSignedEuros(Math.round(top.gap * 100))}.` : " Aucun dépassement.";
  return (
    `Dépenses de ${formatMonthLong(spending.month)} par poste : ${formatEuros(spending.actual)} réelles pour ` +
    `${formatEuros(spending.planned)} prévues.${over}`
  );
}
