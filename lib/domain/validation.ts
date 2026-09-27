/**
 * Form parsing and validation (French messages). Pure functions, shared by the forms and the
 * server actions: the server always re-validates. SPEC D7 / §3 / §8.1.
 */
import { type Cents, type YearMonth, compareMonths, isYearMonth } from "@/lib/engine";
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  type BudgetLineDraft,
  type BudgetExceptionDraft,
  type BudgetSettings,
  type LoanDraft,
  MAX_ACTIVE_LOANS,
  type MonthlyActualDraft,
} from "./types";

/** Largest amount accepted by numeric(12,2). */
const MAX_CENTS = 9_999_999_999_99;

export type Errors = Record<string, string>;
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Errors };

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accepts "1 234,56", "1234.56", "1 234 €"… Up to 2 decimals. */
export function parseAmount(raw: string | null | undefined, { required = true } = {}): Parsed<Cents | null> {
  const text = (raw ?? "").replace(/[\s  €]/g, "").replace(",", ".");
  if (text === "") return required ? { ok: false, error: "Montant requis" } : { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Montant invalide" };
  if (text.startsWith("-")) return { ok: false, error: "Le montant ne peut pas être négatif" };
  const [whole = "0", decimals = ""] = text.split(".");
  if (decimals.length > 2) return { ok: false, error: "2 décimales maximum" };
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (cents > MAX_CENTS) return { ok: false, error: "Montant trop élevé" };
  return { ok: true, value: cents };
}

/** A percentage typed by the user ("4,9" → 0.049). Between 0 and 100, up to 4 decimals. */
export function parsePercent(raw: string | null | undefined): Parsed<number> {
  const text = (raw ?? "").replace(/[\s  %]/g, "").replace(",", ".");
  if (text === "") return { ok: false, error: "Taux requis" };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Taux invalide" };
  const value = Number(text);
  if (value < 0) return { ok: false, error: "Le taux ne peut pas être négatif" };
  if (value > 100) return { ok: false, error: "Le taux doit être inférieur ou égal à 100 %" };
  if ((text.split(".")[1] ?? "").length > 4) return { ok: false, error: "4 décimales maximum" };
  // Round away the binary noise of value / 100 (e.g. 18.9 / 100 = 0.18899999999999997).
  return { ok: true, value: Number((value / 100).toFixed(6)) };
}

export function parseMonth(raw: string | null | undefined): Parsed<YearMonth> {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, error: "Mois requis" };
  return isYearMonth(text) ? { ok: true, value: text } : { ok: false, error: "Mois invalide (AAAA-MM)" };
}

/** Collects field errors while parsing. */
class Collector {
  readonly errors: Errors = {};
  take<T>(field: string, parsed: Parsed<T>): T {
    if (parsed.ok) return parsed.value;
    this.errors[field] = parsed.error;
    return undefined as T;
  }
  fail(field: string, message: string) {
    this.errors[field] ??= message;
  }
  result<T>(value: T): Validated<T> {
    return Object.keys(this.errors).length === 0 ? { ok: true, value } : { ok: false, errors: this.errors };
  }
}

export interface BudgetForm {
  startMonth: string;
  movingGoal: string;
  movingDeadlineMonth: string;
  movingAlreadySaved: string;
  emergencyTarget: string;
  emergencyExisting: string;
  /** Optional ("" or missing = 0). */
  freeSavingsExisting?: string;
  riskFreeRate: string;
  earlyRepaymentPct: string;
  /** startMonth / endMonth: optional YYYY-MM period of the line (SPEC D15). */
  lines: { id?: string; category: string; label: string; amount: string; startMonth?: string; endMonth?: string }[];
}

export function validateBudget(form: BudgetForm): Validated<{ settings: BudgetSettings; lines: BudgetLineDraft[] }> {
  const c = new Collector();
  const settings: BudgetSettings = {
    startMonth: c.take("startMonth", parseMonth(form.startMonth)),
    movingGoal: c.take("movingGoal", parseAmount(form.movingGoal)) as Cents,
    movingDeadlineMonth: c.take("movingDeadlineMonth", parseMonth(form.movingDeadlineMonth)),
    movingAlreadySaved: c.take("movingAlreadySaved", parseAmount(form.movingAlreadySaved)) as Cents,
    emergencyTarget: c.take("emergencyTarget", parseAmount(form.emergencyTarget)) as Cents,
    emergencyExisting: c.take("emergencyExisting", parseAmount(form.emergencyExisting)) as Cents,
    freeSavingsExisting: (c.take("freeSavingsExisting", parseAmount(form.freeSavingsExisting, { required: false })) ?? 0) as Cents,
    riskFreeRate: c.take("riskFreeRate", parsePercent(form.riskFreeRate)),
    earlyRepaymentPct: c.take("earlyRepaymentPct", parsePercent(form.earlyRepaymentPct)),
  };
  const positions: Record<BudgetCategory, number> = { income: 0, fixed: 0, variable: 0 };
  const lines: BudgetLineDraft[] = [];
  form.lines.forEach((line, i) => {
    const category = line.category as BudgetCategory;
    if (!BUDGET_CATEGORIES.includes(category)) {
      c.fail(`lines.${i}.category`, "Catégorie invalide");
      return;
    }
    const label = line.label.trim();
    if (label === "") c.fail(`lines.${i}.label`, "Libellé requis");
    else if (label.length > 100) c.fail(`lines.${i}.label`, "100 caractères maximum");
    const amount = c.take(`lines.${i}.amount`, parseAmount(line.amount)) as Cents;
    const startText = (line.startMonth ?? "").trim();
    const endText = (line.endMonth ?? "").trim();
    const startMonth = startText === "" ? null : (c.take(`lines.${i}.startMonth`, parseMonth(startText)) ?? null);
    const endMonth = endText === "" ? null : (c.take(`lines.${i}.endMonth`, parseMonth(endText)) ?? null);
    if (startMonth && endMonth && compareMonths(endMonth, startMonth) < 0) {
      c.fail(`lines.${i}.endMonth`, "La fin doit être après le début");
    }
    lines.push({
      ...(line.id ? { id: line.id } : {}),
      category,
      label,
      amount,
      position: positions[category]++,
      startMonth,
      endMonth,
    });
  });
  return c.result({ settings, lines });
}

export interface LoanForm {
  name: string;
  type: string;
  principal: string;
  apr: string;
  monthlyPayment: string;
  /** Optional YYYY-MM. */
  contractEndMonth: string;
  /** Optional YYYY-MM: last payment already made when the principal was read. */
  principalPaidThroughMonth: string;
}

/** `activeLoanCount` excludes the loan being edited. */
export function validateLoan(form: LoanForm, activeLoanCount: number): Validated<LoanDraft> {
  const c = new Collector();
  if (activeLoanCount >= MAX_ACTIVE_LOANS) c.fail("form", `${MAX_ACTIVE_LOANS} crédits maximum`);
  const name = form.name.trim();
  const type = form.type.trim();
  if (name.length > 100) c.fail("name", "100 caractères maximum");
  if (type.length > 100) c.fail("type", "100 caractères maximum");
  const principal = c.take("principal", parseAmount(form.principal)) as Cents;
  if (principal === 0) c.fail("principal", "Le capital restant dû doit être supérieur à 0");
  const monthlyPayment = c.take("monthlyPayment", parseAmount(form.monthlyPayment)) as Cents;
  if (monthlyPayment === 0) c.fail("monthlyPayment", "La mensualité doit être supérieure à 0");
  const apr = c.take("apr", parsePercent(form.apr));
  const endText = (form.contractEndMonth ?? "").trim();
  const contractEndMonth = endText === "" ? null : c.take("contractEndMonth", parseMonth(endText));
  const paidText = (form.principalPaidThroughMonth ?? "").trim();
  const principalPaidThroughMonth = paidText === "" ? null : c.take("principalPaidThroughMonth", parseMonth(paidText));
  return c.result({
    name: name || null,
    type: type || null,
    principal,
    principalPaidThroughMonth,
    apr,
    monthlyPayment,
    contractEndMonth,
  });
}

export interface ExceptionForm {
  month: string;
  kind: string;
  label: string;
  amount: string;
}

/** One-off budget exception (SPEC D14): a month, income or expense, a label and an amount > 0. */
export function validateException(form: ExceptionForm): Validated<BudgetExceptionDraft> {
  const c = new Collector();
  const month = c.take("month", parseMonth(form.month));
  const kind = form.kind === "income" || form.kind === "expense" ? form.kind : undefined;
  if (!kind) c.fail("kind", "Choisissez revenu ou dépense");
  const label = form.label.trim();
  if (label === "") c.fail("label", "Libellé requis");
  else if (label.length > 100) c.fail("label", "100 caractères maximum");
  const amount = c.take("amount", parseAmount(form.amount)) as Cents;
  if (amount === 0) c.fail("amount", "Le montant doit être supérieur à 0");
  return c.result({ month, kind: kind as "income" | "expense", label, amount });
}

export interface ActualForm {
  month: string;
  income: string;
  expenses: string;
  movingSavings: string;
  emergencySavings: string;
  freeSavings: string;
  /** One entry per active loan. */
  loanBalances: { loanId: string; balance: string }[];
}

export function validateActual(
  form: ActualForm,
  { startMonth, currentMonth, activeLoanIds }: { startMonth: YearMonth; currentMonth: YearMonth; activeLoanIds: string[] },
): Validated<MonthlyActualDraft> {
  const c = new Collector();
  const month = c.take("month", parseMonth(form.month));
  if (month && compareMonths(month, startMonth) < 0) c.fail("month", "Mois antérieur au début du plan");
  if (month && compareMonths(month, currentMonth) > 0) c.fail("month", "Impossible de saisir un mois futur");

  const given = new Map(form.loanBalances.map((b) => [b.loanId, b.balance]));
  const loanBalances = activeLoanIds.map((loanId) => ({
    loanId,
    balance: c.take(`loan.${loanId}`, parseAmount(given.get(loanId))) as Cents,
  }));
  return c.result({
    month,
    income: c.take("income", parseAmount(form.income, { required: false })),
    expenses: c.take("expenses", parseAmount(form.expenses, { required: false })),
    movingSavings: c.take("movingSavings", parseAmount(form.movingSavings)) as Cents,
    emergencySavings: c.take("emergencySavings", parseAmount(form.emergencySavings)) as Cents,
    freeSavings: c.take("freeSavings", parseAmount(form.freeSavings)) as Cents,
    loanBalances,
    frozen: null,
  });
}
