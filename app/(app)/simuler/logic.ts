/**
 * Pure view-model of the "Et si…" simulator (issue #2, SPEC D17). It starts from the saved plan and
 * keeps every change in memory; only « Appliquer au plan » (#98) writes, after a confirmation.
 */
import { buildPlanInput, referenceMonth } from "@/lib/domain/plan";
import type {
  BudgetException,
  BudgetLine,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  Loan,
  SavingsGoal,
} from "@/lib/domain/types";
import { type Errors, parseAmount, parseMonth, parsePercent, parseSavingsRate, parseYearlyRate } from "@/lib/domain/validation";
import {
  type Cents,
  type ExtraRepaymentInput,
  type PlanInput,
  type PlanKpis,
  type PlanResult,
  type YearMonth,
  HORIZON_MONTHS,
  addMonths,
  centsToEuros,
  compareMonths,
  monthsBetween,
  simulatePlan,
} from "@/lib/engine";
import { amountInputValue, formatEuros, formatEurosWhole, formatMonthLong, formatMonthShort, formatPercent, percentInputValue } from "@/lib/format";
import { formatSignedEuros, goalsName } from "../_dashboard/logic";

export type ExtraSource = ExtraRepaymentInput["source"];

export const EXTRA_SOURCE_LABEL: Record<ExtraSource, string> = {
  freeSavings: "Prélevé sur l’épargne libre",
  external: "Argent en plus (prime, cadeau…)",
};

/** One extra-repayment row as typed. */
export interface ExtraRow {
  key: string;
  loanId: string;
  month: string;
  amount: string;
  source: ExtraSource;
}

/** The inputs as typed (strings, French format). */
export interface SimulationForm {
  earlyRepaymentPct: string;
  riskFreeRate: string;
  /** Yearly indexation in % (SPEC D27). */
  expenseInflationRate: string;
  incomeGrowthRate: string;
  /** Savings interest rates in % (SPEC D28, issue #35 AC-08). */
  emergencyRate: string;
  freeSavingsRate: string;
  /** By budget line id. */
  lineAmounts: Record<string, string>;
  extras: ExtraRow[];
}

/** The last valid value of every input: what the simulated column is computed from. */
export interface Scenario {
  earlyRepaymentPct: number;
  riskFreeRate: number;
  expenseInflationRate: number;
  incomeGrowthRate: number;
  emergencyRate: number;
  freeSavingsRate: number;
  lineAmounts: Record<string, Cents>;
  extras: (ExtraRepaymentInput & { key: string })[];
}

export interface SimulationState {
  form: SimulationForm;
  scenario: Scenario;
  /** French messages by field: `earlyRepaymentPct`, `riskFreeRate`, `line.<id>`, `extra.<key>.<field>`. */
  errors: Errors;
}

/** The saved plan the simulator starts from. */
export interface SimulationBase {
  settings: BudgetSettings;
  lines: BudgetLine[];
  loans: Loan[];
  exceptions: BudgetException[];
  /** Savings goals (SPEC D23), unchanged by the simulation. */
  goals: SavingsGoal[];
  kpiMonth: YearMonth;
}

export function simulationBase(snapshot: FinanceSnapshot, currentMonth: YearMonth): SimulationBase | null {
  const settings = snapshot.settings;
  if (!settings) return null;
  return {
    settings,
    lines: snapshot.lines,
    loans: snapshot.loans,
    exceptions: snapshot.exceptions,
    goals: snapshot.goals,
    kpiMonth: referenceMonth(settings.startMonth, currentMonth),
  };
}

/** Pre-filled with the saved plan (AC-01): simulated = current. */
export function initialSimulation(base: SimulationBase): SimulationState {
  return {
    form: {
      earlyRepaymentPct: percentInputValue(base.settings.earlyRepaymentPct),
      riskFreeRate: percentInputValue(base.settings.riskFreeRate),
      expenseInflationRate: percentInputValue(base.settings.expenseInflationRate ?? 0),
      incomeGrowthRate: percentInputValue(base.settings.incomeGrowthRate ?? 0),
      emergencyRate: percentInputValue(base.settings.emergencyRate ?? 0),
      freeSavingsRate: percentInputValue(base.settings.freeSavingsRate ?? 0),
      lineAmounts: Object.fromEntries(base.lines.map((l) => [l.id, amountInputValue(l.amount)])),
      extras: [],
    },
    scenario: {
      earlyRepaymentPct: base.settings.earlyRepaymentPct,
      riskFreeRate: base.settings.riskFreeRate,
      expenseInflationRate: base.settings.expenseInflationRate ?? 0,
      incomeGrowthRate: base.settings.incomeGrowthRate ?? 0,
      emergencyRate: base.settings.emergencyRate ?? 0,
      freeSavingsRate: base.settings.freeSavingsRate ?? 0,
      lineAmounts: Object.fromEntries(base.lines.map((l) => [l.id, l.amount])),
      extras: [],
    },
    errors: {},
  };
}

/** Engine input of a scenario: the saved plan with the simulated values. */
export function scenarioInput(base: SimulationBase, scenario: Scenario): PlanInput {
  const settings = {
    ...base.settings,
    earlyRepaymentPct: scenario.earlyRepaymentPct,
    riskFreeRate: scenario.riskFreeRate,
    expenseInflationRate: scenario.expenseInflationRate,
    incomeGrowthRate: scenario.incomeGrowthRate,
    emergencyRate: scenario.emergencyRate,
    freeSavingsRate: scenario.freeSavingsRate,
  };
  const lines = base.lines.map((l) => ({ ...l, amount: scenario.lineAmounts[l.id] ?? l.amount }));
  const input = buildPlanInput(settings, lines, base.loans, base.exceptions, base.kpiMonth, base.goals);
  const extraRepayments = scenario.extras.map(({ loanId, month, amount, source }) => ({ loanId, month, amount, source }));
  return { ...input, extraRepayments };
}

export function planBounds(base: SimulationBase): { first: YearMonth; last: YearMonth } {
  return { first: base.settings.startMonth, last: addMonths(base.settings.startMonth, HORIZON_MONTHS - 1) };
}

/**
 * Applies the typed values (AC-07): each valid field updates the scenario; an invalid one shows
 * its error and keeps its last valid value, so the results never break.
 */
export function updateSimulation(prev: SimulationState, form: SimulationForm, base: SimulationBase): SimulationState {
  const errors: Errors = {};
  const pick = <T>(field: string, parsed: { ok: true; value: T } | { ok: false; error: string }, fallback: T): T => {
    if (parsed.ok) return parsed.value;
    errors[field] = parsed.error;
    return fallback;
  };

  const lineAmounts: Record<string, Cents> = {};
  for (const line of base.lines) {
    const fallback = prev.scenario.lineAmounts[line.id] ?? line.amount;
    const parsed = parseAmount(form.lineAmounts[line.id]);
    lineAmounts[line.id] = pick(`line.${line.id}`, parsed.ok ? { ok: true, value: parsed.value ?? 0 } : parsed, fallback);
  }

  const scenario: Scenario = {
    earlyRepaymentPct: pick("earlyRepaymentPct", parsePercent(form.earlyRepaymentPct), prev.scenario.earlyRepaymentPct),
    riskFreeRate: pick("riskFreeRate", parsePercent(form.riskFreeRate), prev.scenario.riskFreeRate),
    expenseInflationRate: pick("expenseInflationRate", parseYearlyRate(form.expenseInflationRate), prev.scenario.expenseInflationRate),
    incomeGrowthRate: pick("incomeGrowthRate", parseYearlyRate(form.incomeGrowthRate), prev.scenario.incomeGrowthRate),
    emergencyRate: pick("emergencyRate", parseSavingsRate(form.emergencyRate), prev.scenario.emergencyRate),
    freeSavingsRate: pick("freeSavingsRate", parseSavingsRate(form.freeSavingsRate), prev.scenario.freeSavingsRate),
    lineAmounts,
    extras: [],
  };

  const previous = new Map(prev.scenario.extras.map((e) => [e.key, e]));
  const { first, last } = planBounds(base);
  scenario.extras = form.extras.flatMap((row) => {
    const field = (name: string) => `extra.${row.key}.${name}`;
    const before = Object.keys(errors).length;
    if (!base.loans.some((l) => l.id === row.loanId)) errors[field("loanId")] = "Choisissez un crédit";
    const month = parseMonth(row.month);
    if (!month.ok) errors[field("month")] = month.error;
    else if (compareMonths(month.value, first) < 0 || compareMonths(month.value, last) > 0) {
      errors[field("month")] = `Mois hors du plan (de ${formatMonthLong(first)} à ${formatMonthLong(last)})`;
    }
    const amount = parseAmount(row.amount);
    if (!amount.ok) errors[field("amount")] = amount.error;
    else if (!amount.value) errors[field("amount")] = "Le montant doit être supérieur à 0";

    if (Object.keys(errors).length === before && month.ok && amount.ok && amount.value) {
      return [{ key: row.key, loanId: row.loanId, month: month.value, amount: amount.value, source: row.source }];
    }
    const kept = previous.get(row.key);
    return kept ? [kept] : [];
  });

  // An amount larger than the loan's balance that month is refused too (AC-07). Dropping or
  // restoring a row can change later balances, hence the loop (at most one pass per row).
  for (let pass = 0; pass <= scenario.extras.length; pass++) {
    const over = extrasOverBalance(simulatePlan(scenarioInput(base, scenario)), scenario);
    if (over.length === 0) break;
    const rejected = new Set(over.map((o) => o.key));
    for (const o of over) {
      errors[`extra.${o.key}.amount`] ??=
        o.open === 0
          ? `Ce crédit est déjà remboursé en ${formatMonthLong(o.month)} dans la simulation`
          : `Dépasse le solde restant en ${formatMonthLong(o.month)} : ${formatEuros(o.open)} maximum`;
    }
    scenario.extras = scenario.extras.flatMap((e) => {
      if (!rejected.has(e.key)) return [e];
      const kept = previous.get(e.key);
      return kept && kept !== e ? [kept] : [];
    });
  }

  return { form, scenario, errors };
}

/** Rows asking for more than the loan's balance after that month's payment (and earlier rows). */
export function extrasOverBalance(
  result: PlanResult,
  scenario: Pick<Scenario, "extras">,
): { key: string; month: YearMonth; open: Cents }[] {
  const start = result.months[0]?.month;
  if (!start) return [];
  const loanIds = result.loans.map((l) => l.id);
  const used = new Map<string, Cents>();
  const over: { key: string; month: YearMonth; open: Cents }[] = [];
  for (const e of scenario.extras) {
    const planMonth = result.months[monthsBetween(start, e.month)];
    const loanIndex = loanIds.indexOf(e.loanId);
    const loan = planMonth?.loans[loanIndex];
    if (!planMonth || !loan) continue;
    const id = `${e.month}|${e.loanId}`;
    const open = Math.max(0, loan.balanceAfterPayment - (used.get(id) ?? 0));
    if (e.amount > open) over.push({ key: e.key, month: e.month, open });
    else used.set(id, (used.get(id) ?? 0) + e.amount);
  }
  return over;
}

export type Tone = "good" | "bad";

export interface ComparisonRow {
  key: string;
  label: string;
  current: string;
  simulated: string;
  difference: string;
  tone: Tone | null;
}

const monthOrDash = (m: YearMonth | null, none: string) => (m ? formatMonthLong(m) : none);

/** "3 mois plus tôt" (good) / "2 mois plus tard" (bad) / "Identique". */
export function monthDifference(current: YearMonth | null, simulated: YearMonth | null): { text: string; tone: Tone | null } {
  if (current === null && simulated === null) return { text: "Identique", tone: null };
  if (current === null) return { text: "Atteint dans la simulation", tone: "good" };
  if (simulated === null) return { text: "Plus atteint dans la simulation", tone: "bad" };
  const d = monthsBetween(current, simulated);
  if (d === 0) return { text: "Identique", tone: null };
  return d < 0 ? { text: `${-d} mois plus tôt`, tone: "good" } : { text: `${d} mois plus tard`, tone: "bad" };
}

/** Signed difference; `higherIsBetter` decides the tone. */
export function moneyDifference(current: Cents, simulated: Cents, higherIsBetter = true): { text: string; tone: Tone | null } {
  const d = simulated - current;
  if (d === 0) return { text: "Identique", tone: null };
  return { text: formatSignedEuros(d), tone: d > 0 === higherIsBetter ? "good" : "bad" };
}

function movingText(k: PlanKpis): string {
  if (k.deadlineBeforeStart) return "Date limite dépassée";
  return k.movingGoalMet
    ? `Tenu, atteint en ${monthOrDash(k.movingReachedMonth, "—")}`
    : `Non tenu : ${formatEuros(k.movingAmountAtDeadline)} à la date limite`;
}

function movingDifference(current: PlanKpis, simulated: PlanKpis): { text: string; tone: Tone | null } {
  if (current.movingGoalMet !== simulated.movingGoalMet) {
    return simulated.movingGoalMet ? { text: "Devient tenu", tone: "good" } : { text: "N’est plus tenu", tone: "bad" };
  }
  if (current.movingGoalMet) return monthDifference(current.movingReachedMonth, simulated.movingReachedMonth);
  return moneyDifference(current.movingAmountAtDeadline, simulated.movingAmountAtDeadline);
}

/** The five compared outputs (AC-04), current vs simulated, with the difference. */
export function compareScenarios(current: PlanKpis, simulated: PlanKpis): ComparisonRow[] {
  const debtFree = (k: PlanKpis) => (k.hasDebt ? monthOrDash(k.debtFreeMonth, "Au-delà de 25 ans") : "Aucune dette");
  const rows: ComparisonRow[] = [];
  const push = (key: string, label: string, c: string, s: string, diff: { text: string; tone: Tone | null }) =>
    rows.push({ key, label, current: c, simulated: s, difference: diff.text, tone: diff.tone });

  push("debtFree", "Sans dette en", debtFree(current), debtFree(simulated), monthDifference(current.debtFreeMonth, simulated.debtFreeMonth));
  push(
    "interestSaved",
    "Intérêts économisés",
    formatEuros(current.interestSaved),
    formatEuros(simulated.interestSaved),
    moneyDifference(current.interestSaved, simulated.interestSaved),
  );
  push("moving", current.goals.length > 1 ? "Objectifs d’épargne" : `Objectif « ${goalsName(current)} »`, movingText(current), movingText(simulated), movingDifference(current, simulated));
  push(
    "emergency",
    "Fonds d’urgence complet en",
    monthOrDash(current.emergencyReachedMonth, "Non atteint (25 ans)"),
    monthOrDash(simulated.emergencyReachedMonth, "Non atteint (25 ans)"),
    monthDifference(current.emergencyReachedMonth, simulated.emergencyReachedMonth),
  );
  push(
    "freeSavings12",
    "Épargne libre à 12 mois",
    formatEuros(current.freeSavingsAt12),
    formatEuros(simulated.freeSavingsAt12),
    moneyDifference(current.freeSavingsAt12, simulated.freeSavingsAt12),
  );
  return rows;
}

/** First month whose cumulative free savings are negative (an extra taken from savings too early). */
export function firstNegativeFreeSavings(result: PlanResult): YearMonth | null {
  return result.months.find((m) => m.freeSavingsCumulative < 0)?.month ?? null;
}

/** Months shown by the charts: until both scenarios are debt-free (+3), at least 24, at most 300. */
export function chartMonthCount(current: PlanResult, simulated: PlanResult): number {
  const end = (r: PlanResult) => {
    if (!r.kpis.hasDebt) return 0;
    if (!r.kpis.debtFreeMonth) return 120;
    return r.months.findIndex((m) => m.month === r.kpis.debtFreeMonth) + 1;
  };
  return Math.min(HORIZON_MONTHS, Math.max(24, end(current) + 3, end(simulated) + 3));
}

export type ScenarioPoint = {
  month: string;
  label: string;
  currentDebt: number;
  simulatedDebt: number;
  currentFreeSavings: number;
  simulatedFreeSavings: number;
};

/** Both scenarios month by month, in euros (AC-08). */
export function scenarioSeries(current: PlanResult, simulated: PlanResult, count: number): ScenarioPoint[] {
  return current.months.slice(0, count).map((m, i) => {
    const s = simulated.months[i] ?? m;
    return {
      month: m.month,
      label: formatMonthShort(m.month),
      currentDebt: centsToEuros(m.remainingDebt),
      simulatedDebt: centsToEuros(s.remainingDebt),
      currentFreeSavings: centsToEuros(m.freeSavingsCumulative),
      simulatedFreeSavings: centsToEuros(s.freeSavingsCumulative),
    };
  });
}

/** Text alternative of a comparison chart. */
export function scenarioSummary(current: PlanResult, simulated: PlanResult, count: number, what: "debt" | "freeSavings"): string {
  const pick = (r: PlanResult) => (what === "debt" ? r.months[count - 1]?.remainingDebt : r.months[count - 1]?.freeSavingsCumulative) ?? 0;
  const lastMonth = current.months[count - 1]?.month;
  if (!lastMonth) return "Aucune donnée.";
  const noun = what === "debt" ? "Dette restante" : "Épargne libre cumulée";
  return `${noun} sur ${count} mois. En ${formatMonthLong(lastMonth)} : plan actuel ${formatEurosWhole(pick(current))}, simulation ${formatEurosWhole(pick(simulated))}.`;
}

/* ------------------------------------------ #98 Appliquer au plan ------------------------------------------ */

export interface PlanChange {
  label: string;
  from: string;
  to: string;
}

/** The simulated parameters « Appliquer » copies into the saved plan, with their labels. */
const APPLIED_RATES = [
  ["earlyRepaymentPct", "Remboursement anticipé"],
  ["riskFreeRate", "Taux seuil"],
  ["expenseInflationRate", "Inflation des charges, par an"],
  ["incomeGrowthRate", "Évolution des revenus, par an"],
  ["emergencyRate", "Taux d’intérêt du fonds d’urgence"],
  ["freeSavingsRate", "Taux d’intérêt de l’épargne libre"],
] as const;

/** What « Appliquer au plan » changes in the saved plan, old → new: the parameters, then the budget lines. */
export function appliedChanges(base: SimulationBase, scenario: Scenario): PlanChange[] {
  const changes: PlanChange[] = [];
  for (const [key, label] of APPLIED_RATES) {
    const from = base.settings[key] ?? 0;
    const to = scenario[key];
    if (from !== to) changes.push({ label, from: formatPercent(from, 4), to: formatPercent(to, 4) });
  }
  for (const line of base.lines) {
    const to = scenario.lineAmounts[line.id] ?? line.amount;
    if (to !== line.amount) changes.push({ label: line.label, from: formatEuros(line.amount), to: formatEuros(to) });
  }
  return changes;
}

/**
 * The saved plan with the simulated values (#98): every editable parameter and the budget line
 * amounts. Lines keep everything else (period, indexation, payday). Extra repayments are not part
 * of the plan and are left out.
 */
export function appliedPlan(base: SimulationBase, scenario: Scenario): { settings: BudgetSettings; lines: BudgetLineDraft[] } {
  const settings: BudgetSettings = { ...base.settings };
  for (const [key] of APPLIED_RATES) settings[key] = scenario[key];
  const lines = base.lines.map((line) => ({ ...line, amount: scenario.lineAmounts[line.id] ?? line.amount }));
  return { settings, lines };
}
