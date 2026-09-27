/**
 * Budget form state and the live preview (pure, shared by the client form and the server action).
 * Amounts stay as typed strings; the preview skips invalid values, the server re-validates everything.
 */
import { type Cents, type PlanResult, type YearMonth, simulatePlan, sumCents } from "@/lib/engine";
import { buildPlanInput } from "@/lib/domain/plan";
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type BudgetException,
  type BudgetLine,
  type BudgetSettings,
  type Loan,
} from "@/lib/domain/types";
import { type BudgetForm, parseAmount, validateBudget } from "@/lib/domain/validation";
import { amountInputValue, percentInputValue } from "@/lib/format";
import { affectedMonthCount } from "./exceptions-view";

export const PARAM_FIELDS = [
  "startMonth",
  "movingGoal",
  "movingDeadlineMonth",
  "movingAlreadySaved",
  "emergencyTarget",
  "emergencyExisting",
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
        movingGoal: amountInputValue(settings.movingGoal),
        movingDeadlineMonth: settings.movingDeadlineMonth,
        movingAlreadySaved: amountInputValue(settings.movingAlreadySaved),
        emergencyTarget: amountInputValue(settings.emergencyTarget),
        emergencyExisting: amountInputValue(settings.emergencyExisting),
        riskFreeRate: percentInputValue(settings.riskFreeRate),
        earlyRepaymentPct: percentInputValue(settings.earlyRepaymentPct),
      }
    : {
        startMonth: currentMonth,
        movingGoal: "0",
        movingDeadlineMonth: "",
        movingAlreadySaved: "0",
        emergencyTarget: "0",
        emergencyExisting: "0",
        riskFreeRate: "",
        earlyRepaymentPct: "",
      };
  const sorted = [...lines].sort(
    (a, b) => BUDGET_CATEGORIES.indexOf(a.category) - BUDGET_CATEGORIES.indexOf(b.category) || a.position - b.position,
  );
  return {
    params,
    lines: sorted.map((l) => ({ key: l.id, id: l.id, category: l.category, label: l.label, amount: amountInputValue(l.amount) })),
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
      lines: lines.map((l) => ({ ...(l.id ? { id: l.id } : {}), category: l.category, label: l.label, amount: l.amount })),
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
  const keys = Array.isArray(data.keys) ? data.keys : [];
  return {
    form: {
      startMonth: text(form.startMonth),
      movingGoal: text(form.movingGoal),
      movingDeadlineMonth: text(form.movingDeadlineMonth),
      movingAlreadySaved: text(form.movingAlreadySaved),
      emergencyTarget: text(form.emergencyTarget),
      emergencyExisting: text(form.emergencyExisting),
      riskFreeRate: text(form.riskFreeRate),
      earlyRepaymentPct: text(form.earlyRepaymentPct),
      lines: rawLines.map((l) => {
        const line = isRecord(l) ? l : {};
        const id = text(line.id);
        return { ...(id ? { id } : {}), category: text(line.category), label: text(line.label), amount: text(line.amount) };
      }),
    },
    keys: rawLines.map((_, i) => String(keys[i] ?? i).slice(0, 100)),
  };
}

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

export type DebtAlertLevel = "ok" | "warning" | "alert";

export interface BudgetPreview {
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

/**
 * Totals of a regular month from the valid amounts, and the simulated plan (saved one-off exceptions
 * included) when every parameter is valid.
 */
export function computePreview(
  state: BudgetFormState,
  loans: readonly Loan[],
  exceptions: readonly BudgetException[] = [],
): BudgetPreview {
  let invalidAmounts = 0;
  const validLines: { category: BudgetCategory; amount: Cents }[] = [];
  for (const line of state.lines) {
    const parsed = parseAmount(line.amount);
    if (parsed.ok && parsed.value !== null) validLines.push({ category: line.category, amount: parsed.value });
    else invalidAmounts++;
  }
  const total = (category: BudgetCategory) => sumCents(validLines.filter((l) => l.category === category).map((l) => l.amount));
  const income = total("income");
  const fixed = total("fixed");
  const variable = total("variable");
  const loanPayments = sumCents(loans.map((l) => l.monthlyPayment));
  // Same rules as the engine KPIs (SPEC §7 B7–B9), available even before the parameters are valid.
  const debtRatio = income === 0 ? null : loanPayments / income;
  const ratio = debtRatio ?? 0;
  const settings = parseSettings(state.params);
  return {
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
    plan: settings ? simulatePlan(buildPlanInput(settings, validLines, loans, exceptions)) : null,
  };
}

/** Sum of the valid amounts of one section. */
export function sectionTotal(lines: readonly LineState[], category: BudgetCategory): Cents {
  return sumCents(
    lines
      .filter((l) => l.category === category)
      .map((l) => parseAmount(l.amount))
      .flatMap((p) => (p.ok && p.value !== null ? [p.value] : [])),
  );
}
