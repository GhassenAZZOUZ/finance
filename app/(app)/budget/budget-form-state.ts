/**
 * Budget form state and the live preview (pure, shared by the client form and the server action).
 * Amounts stay as typed strings; the preview skips invalid values, the server re-validates everything.
 */
import {
  type Cents,
  HORIZON_MONTHS,
  type PlanResult,
  type YearMonth,
  addMonths,
  compareMonths,
  isLineActive,
  isYearMonth,
  simulatePlan,
  sumCents,
} from "@/lib/engine";
import { buildPlanInput, referenceMonth } from "@/lib/domain/plan";
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type BudgetException,
  type BudgetLine,
  type BudgetSettings,
  type Loan, type SavingsGoal } from "@/lib/domain/types";
import { type BudgetForm, parseAmount, validateBudget } from "@/lib/domain/validation";
import { amountInputValue, formatMonthShort, percentInputValue } from "@/lib/format";
import { affectedMonthCount } from "./exceptions-view";

export const PARAM_FIELDS = [
  "startMonth",
  "emergencyTarget",
  "emergencyExisting",
  "freeSavingsExisting",
  "riskFreeRate",
  "earlyRepaymentPct",
] as const;
export type ParamField = (typeof PARAM_FIELDS)[number];
export type ParamValues = Record<ParamField, string>;

export interface LineState {
  /** Stable React key: the id for saved lines, a client-generated key for new ones. */
  key: string;
  id?: string;
  category: BudgetCategory;
  label: string;
  amount: string;
  /** Optional period (SPEC D15), YYYY-MM or "" for no limit; both bounds inclusive. */
  startMonth: string;
  endMonth: string;
}

export interface BudgetFormState {
  params: ParamValues;
  lines: LineState[];
}

/** What the client posts: the form plus each line's key, so errors (lines.<index>.*) map back to rows. */
export interface BudgetPayload {
  form: BudgetForm;
  keys: string[];
}

/** Form values from the saved data. First visit (no settings): start = current month, rates empty. */
export function initialFormState(settings: BudgetSettings | null, lines: readonly BudgetLine[], currentMonth: YearMonth): BudgetFormState {
  const params: ParamValues = settings
    ? {
        startMonth: settings.startMonth,
        emergencyTarget: amountInputValue(settings.emergencyTarget),
        emergencyExisting: amountInputValue(settings.emergencyExisting),
        freeSavingsExisting: amountInputValue(settings.freeSavingsExisting),
        riskFreeRate: percentInputValue(settings.riskFreeRate),
        earlyRepaymentPct: percentInputValue(settings.earlyRepaymentPct),
      }
    : {
        startMonth: currentMonth,
        emergencyTarget: "0",
        emergencyExisting: "0",
        freeSavingsExisting: "0",
        riskFreeRate: "",
        earlyRepaymentPct: "",
      };
  const sorted = [...lines].sort(
    (a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category) || a.position - b.position,
  );
  return {
    params,
    lines: sorted.map((l) => ({
      key: l.id,
      id: l.id,
      category: l.category,
      label: l.label,
      amount: amountInputValue(l.amount),
      startMonth: l.startMonth ?? "",
      endMonth: l.endMonth ?? "",
    })),
  };
}

/** Lines grouped by category (income, fixed, variable), keeping the order within each category. */
export function orderedLines(lines: readonly LineState[]): LineState[] {
  return BUDGET_CATEGORIES.flatMap((category) => lines.filter((l) => l.category === category));
}

export function toPayload(state: BudgetFormState): BudgetPayload {
  const lines = orderedLines(state.lines);
  return {
    form: {
      ...state.params,
      lines: lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        category: l.category,
        label: l.label,
        amount: l.amount,
        startMonth: l.startMonth,
        endMonth: l.endMonth,
      })),
    },
    keys: lines.map((l) => l.key),
  };
}

/** Serialized form, to detect unsaved changes. */
export function formSignature(state: BudgetFormState): string {
  return JSON.stringify(toPayload(state).form);
}

/** Server side: turns an untrusted JSON string into a BudgetPayload (every field coerced to a string). */
export function parsePayload(raw: unknown, maxLines = 200): BudgetPayload | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || !isRecord(data.form) || !Array.isArray(data.form.lines)) return null;
  const form = data.form;
  const rawLines = form.lines as unknown[];
  if (rawLines.length > maxLines) return null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  // Months: strings only, capped (anything longer than "YYYY-MM" plus spaces is rejected by validateBudget).
  const month = (v: unknown) => text(v).slice(0, MAX_MONTH_LENGTH);
  const keys = Array.isArray(data.keys) ? data.keys : [];
  return {
    form: {
      startMonth: text(form.startMonth),
      emergencyTarget: text(form.emergencyTarget),
      emergencyExisting: text(form.emergencyExisting),
      freeSavingsExisting: text(form.freeSavingsExisting),
      riskFreeRate: text(form.riskFreeRate),
      earlyRepaymentPct: text(form.earlyRepaymentPct),
      lines: rawLines.map((l) => {
        const line = isRecord(l) ? l : {};
        const id = text(line.id);
        return {
          ...(id ? { id } : {}),
          category: text(line.category),
          label: text(line.label),
          amount: text(line.amount),
          startMonth: month(line.startMonth),
          endMonth: month(line.endMonth),
        };
      }),
    },
    keys: rawLines.map((_, i) => String(keys[i] ?? i).slice(0, 100)),
  };
}

const MAX_MONTH_LENGTH = 20;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The parameters, or null while any of them is missing or invalid. */
export function parseSettings(params: ParamValues): BudgetSettings | null {
  const result = validateBudget({ ...params, lines: [] });
  return result.ok ? result.value.settings : null;
}

/** Parameters that currently block the preview. */
export function invalidParams(params: ParamValues): ParamField[] {
  const result = validateBudget({ ...params, lines: [] });
  return result.ok ? [] : PARAM_FIELDS.filter((f) => f in result.errors);
}

/** A typed month, or null when empty or malformed (validateBudget reports the malformed ones on save). */
function monthOrNull(raw: string): YearMonth | null {
  const text = raw.trim();
  return isYearMonth(text) ? text : null;
}

export interface LinePeriod {
  startMonth: YearMonth | null;
  endMonth: YearMonth | null;
}

/** The line's period as months (malformed bounds count as "no limit" in the live preview). */
export function linePeriod(line: Pick<LineState, "startMonth" | "endMonth">): LinePeriod {
  return { startMonth: monthOrNull(line.startMonth), endMonth: monthOrNull(line.endMonth) };
}

export function hasPeriod(line: Pick<LineState, "startMonth" | "endMonth">): boolean {
  const p = linePeriod(line);
  return p.startMonth !== null || p.endMonth !== null;
}

/** "jusqu’à juin 2027", "à partir de juil. 2027", "de juil. 2027 à déc. 2027"; null without a period. */
export function periodText({ startMonth, endMonth }: LinePeriod): string | null {
  if (startMonth && endMonth) {
    return startMonth === endMonth
      ? `en ${formatMonthShort(startMonth)} uniquement`
      : `de ${formatMonthShort(startMonth)} à ${formatMonthShort(endMonth)}`;
  }
  if (startMonth) return `à partir de ${formatMonthShort(startMonth)}`;
  if (endMonth) return `jusqu’à ${formatMonthShort(endMonth)}`;
  return null;
}

/**
 * True when the period never meets the simulated months [planStart, planStart + HORIZON_MONTHS):
 * it ends before the plan starts or starts after its last month (the line has no effect).
 */
export function isOutsidePlan({ startMonth, endMonth }: LinePeriod, planStart: YearMonth | null): boolean {
  if (!planStart) return false;
  const last = addMonths(planStart, HORIZON_MONTHS - 1);
  return (endMonth !== null && compareMonths(endMonth, planStart) < 0) || (startMonth !== null && compareMonths(startMonth, last) > 0);
}

/** Plan start typed in the form when valid, else the saved one (null on a first visit with a bad month). */
export function formPlanStart(params: ParamValues, savedStartMonth: YearMonth | null): YearMonth | null {
  return monthOrNull(params.startMonth) ?? savedStartMonth;
}

/**
 * Month the totals and KPIs describe (SPEC D15): the current month kept within the plan period.
 * Without a plan start, the current month.
 */
export function previewMonth(planStart: YearMonth | null, currentMonth: YearMonth): YearMonth {
  return planStart ? referenceMonth(planStart, currentMonth) : currentMonth;
}

export type DebtAlertLevel = "ok" | "warning" | "alert";

export interface BudgetPreview {
  /** Month described by the totals and KPIs below (SPEC D15); null when unknown (all lines summed). */
  referenceMonth: YearMonth | null;
  /** Some line has a start or end month: the budget changes over the plan. */
  hasPeriods: boolean;
  income: Cents;
  fixed: Cents;
  variable: Cents;
  loanPayments: Cents;
  margin: Cents;
  /** null when income is 0 (UI shows "—", SPEC D10). */
  debtRatio: number | null;
  debtAlert: DebtAlertLevel;
  /** Lines whose amount is invalid and is left out of the totals. */
  invalidAmounts: number;
  /** 3 × (fixed + variable + Σ monthly payments), SPEC §3.1 (hint only). */
  suggestedEmergencyTarget: Cents;
  /** Distinct months inside the plan period that carry a saved one-off exception (SPEC D14). */
  exceptionMonths: number;
  /** Null while the parameters are incomplete. */
  plan: PlanResult | null;
}

export interface PreviewOptions {
  /** Today's month; the reference month is derived from it (defaults to the plan start). */
  currentMonth?: YearMonth;
  /** Saved plan start, used while the typed one is invalid. */
  savedStartMonth?: YearMonth | null;
  /** Savings goals (SPEC D23): the primary one takes the typed moving fund. */
  goals?: readonly SavingsGoal[];
}

/**
 * Totals of the reference month from the valid amounts (only the lines active that month), and the
 * simulated plan (line periods and saved one-off exceptions included) when every parameter is valid.
 */
export function computePreview(
  state: BudgetFormState,
  loans: readonly Loan[],
  exceptions: readonly BudgetException[] = [],
  { currentMonth, savedStartMonth = null, goals = [] }: PreviewOptions = {},
): BudgetPreview {
  let invalidAmounts = 0;
  const validLines: ({ category: BudgetCategory; amount: Cents } & LinePeriod)[] = [];
  for (const line of state.lines) {
    const parsed = parseAmount(line.amount);
    if (parsed.ok && parsed.value !== null) validLines.push({ category: line.category, amount: parsed.value, ...linePeriod(line) });
    else invalidAmounts++;
  }
  const settings = parseSettings(state.params);
  const planStart = formPlanStart(state.params, savedStartMonth);
  const month = planStart ? previewMonth(planStart, currentMonth ?? planStart) : (currentMonth ?? null);
  const total = (category: BudgetCategory) =>
    sumCents(validLines.filter((l) => l.category === category && (!month || isLineActive(l, month))).map((l) => l.amount));
  const income = total("income");
  const fixed = total("fixed");
  const variable = total("variable");
  const loanPayments = sumCents(loans.map((l) => l.monthlyPayment));
  // Same rules as the engine KPIs (SPEC §7 B7–B9), available even before the parameters are valid.
  const debtRatio = income === 0 ? null : loanPayments / income;
  const ratio = debtRatio ?? 0;
  return {
    referenceMonth: month,
    hasPeriods: validLines.some((l) => l.startMonth !== null || l.endMonth !== null),
    income,
    fixed,
    variable,
    loanPayments,
    margin: income - fixed - variable - loanPayments,
    debtRatio,
    debtAlert: ratio > 0.35 ? "alert" : ratio > 0.3 ? "warning" : "ok",
    invalidAmounts,
    suggestedEmergencyTarget: 3 * (fixed + variable + loanPayments),
    exceptionMonths: affectedMonthCount(exceptions, settings?.startMonth ?? null),
    // With valid settings, `month` is the reference month of the typed plan start.
    plan: settings ? simulatePlan(buildPlanInput(settings, validLines, loans, exceptions, month ?? settings.startMonth, goals)) : null,
  };
}

/** Sum of the valid amounts of one section; with `month`, only the lines active that month. */
export function sectionTotal(lines: readonly LineState[], category: BudgetCategory, month?: YearMonth | null): Cents {
  return sumCents(
    lines
      .filter((l) => l.category === category && (!month || isLineActive(linePeriod(l), month)))
      .map((l) => parseAmount(l.amount))
      .flatMap((p) => (p.ok && p.value !== null ? [p.value] : [])),
  );
}
