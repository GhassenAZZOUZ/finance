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
  type SavingsGoalDraft,
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

/**
 * Optional yearly rate in % (SPEC D27): "" = 0; from −100 % to 100 %, 4 decimals at most.
 * Returns a fraction (2 → 0.02).
 */
export function parseYearlyRate(raw: string | null | undefined): Parsed<number> {
  const text = (raw ?? "").replace(/[\s  %]/g, "").replace(",", ".").replace("−", "-");
  if (text === "") return { ok: true, value: 0 };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: "Taux invalide" };
  const value = Number(text);
  if (value < -100 || value > 100) return { ok: false, error: "Le taux doit être compris entre −100 % et 100 %" };
  if ((text.split(".")[1] ?? "").length > 4) return { ok: false, error: "4 décimales maximum" };
  return { ok: true, value: Number((value / 100).toFixed(6)) + 0 };
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
  emergencyTarget: string;
  emergencyExisting: string;
  /** Optional ("" or missing = 0). */
  freeSavingsExisting?: string;
  riskFreeRate: string;
  earlyRepaymentPct: string;
  /** Optional yearly rates in % (SPEC D27); "" = 0. Missing = not part of this form. */
  expenseInflationRate?: string;
  incomeGrowthRate?: string;
  /**
   * startMonth / endMonth: optional YYYY-MM period of the line (SPEC D15); indexed: false for a
   * « non indexé » line (D27).
   */
  lines: { id?: string; category: string; label: string; amount: string; startMonth?: string; endMonth?: string; indexed?: boolean }[];
}

export function validateBudget(form: BudgetForm): Validated<{ settings: BudgetSettings; lines: BudgetLineDraft[] }> {
  const c = new Collector();
  const settings: BudgetSettings = {
    startMonth: c.take("startMonth", parseMonth(form.startMonth)),
    emergencyTarget: c.take("emergencyTarget", parseAmount(form.emergencyTarget)) as Cents,
    emergencyExisting: c.take("emergencyExisting", parseAmount(form.emergencyExisting)) as Cents,
    freeSavingsExisting: (c.take("freeSavingsExisting", parseAmount(form.freeSavingsExisting, { required: false })) ?? 0) as Cents,
    riskFreeRate: c.take("riskFreeRate", parsePercent(form.riskFreeRate)),
    earlyRepaymentPct: c.take("earlyRepaymentPct", parsePercent(form.earlyRepaymentPct)),
    ...(form.expenseInflationRate !== undefined
      ? { expenseInflationRate: c.take("expenseInflationRate", parseYearlyRate(form.expenseInflationRate)) }
      : {}),
    ...(form.incomeGrowthRate !== undefined ? { incomeGrowthRate: c.take("incomeGrowthRate", parseYearlyRate(form.incomeGrowthRate)) } : {}),
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
      ...(line.indexed === false ? { indexed: false } : {}),
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
  /** Optional IRA in % of the capital repaid early (SPEC D22); "" or missing = none. */
  penaltyPct?: string;
  /** Optional cap in months of interest; "" or missing = no cap. */
  penaltyCapMonths?: string;
  /** "overdraft" (SPEC D24); missing = a loan. */
  kind?: string;
  /** Overdraft only: authorised amount. */
  creditLimit?: string;
}

/** Whole number of months, 0 to 120 ("6", " 6 "). */
function parseCapMonths(raw: string): Parsed<number> {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "Nombre de mois entier attendu" };
  const value = Number(text);
  if (value > 120) return { ok: false, error: "120 mois maximum" };
  return { ok: true, value };
}

/** `activeLoanCount` excludes the loan being edited. */
export function validateLoan(form: LoanForm, activeLoanCount: number): Validated<LoanDraft> {
  if (form.kind === "overdraft") return validateOverdraft(form, activeLoanCount);
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
  const penaltyText = (form.penaltyPct ?? "").trim();
  const capText = (form.penaltyCapMonths ?? "").trim();
  const penaltyPct = penaltyText === "" ? null : c.take("penaltyPct", parsePercent(penaltyText));
  const penaltyCapMonths = capText === "" ? null : c.take("penaltyCapMonths", parseCapMonths(capText));
  if (penaltyCapMonths !== null && penaltyPct === null && !c.errors.penaltyPct) {
    c.fail("penaltyCapMonths", "Indiquez d’abord le pourcentage d’IRA");
  }
  return c.result({
    name: name || null,
    type: type || null,
    principal,
    principalPaidThroughMonth,
    apr,
    monthlyPayment,
    contractEndMonth,
    penaltyPct: penaltyPct ?? null,
    penaltyCapMonths: penaltyCapMonths ?? null,
    kind: "loan",
    creditLimit: null,
  });
}

/**
 * A bank overdraft (SPEC D24): authorised limit > 0, balance used between 0 and the limit, agios
 * rate 0–100 %, optional fixed monthly repayment (empty = 0). Counts in the 6-debt limit (D7).
 */
function validateOverdraft(form: LoanForm, activeLoanCount: number): Validated<LoanDraft> {
  const c = new Collector();
  if (activeLoanCount >= MAX_ACTIVE_LOANS) c.fail("form", `${MAX_ACTIVE_LOANS} crédits maximum`);
  const name = form.name.trim();
  if (name.length > 100) c.fail("name", "100 caractères maximum");
  const creditLimit = c.take("creditLimit", parseAmount(form.creditLimit)) as Cents;
  if (creditLimit === 0) c.fail("creditLimit", "L’autorisation doit être supérieure à 0");
  const principal = c.take("principal", parseAmount(form.principal)) as Cents;
  if (principal !== undefined && creditLimit !== undefined && creditLimit > 0 && principal > creditLimit) {
    c.fail("principal", "Le solde utilisé ne peut pas dépasser l’autorisation");
  }
  const apr = c.take("apr", parsePercent(form.apr));
  const monthlyPayment = (c.take("monthlyPayment", parseAmount(form.monthlyPayment, { required: false })) ?? 0) as Cents;
  return c.result({
    name: name || null,
    type: "Découvert bancaire",
    principal,
    principalPaidThroughMonth: null,
    apr,
    monthlyPayment,
    contractEndMonth: null,
    penaltyPct: null,
    penaltyCapMonths: null,
    kind: "overdraft",
    creditLimit,
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
  emergencySavings: string;
  freeSavings: string;
  /** One entry per active loan. */
  loanBalances: { loanId: string; balance: string }[];
  /** One entry per savings goal, the primary one included (SPEC D23). */
  goalBalances?: { goalId: string; balance: string }[];
}

export function validateActual(
  form: ActualForm,
  {
    startMonth,
    currentMonth,
    activeLoanIds,
    goalIds = [],
  }: { startMonth: YearMonth; currentMonth: YearMonth; activeLoanIds: string[]; goalIds?: string[] },
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
  const givenGoals = new Map((form.goalBalances ?? []).map((b) => [b.goalId, b.balance]));
  const goalBalances = goalIds.map((goalId) => ({
    goalId,
    balance: c.take(`goal.${goalId}`, parseAmount(givenGoals.get(goalId))) as Cents,
  }));
  return c.result({
    month,
    income: c.take("income", parseAmount(form.income, { required: false })),
    expenses: c.take("expenses", parseAmount(form.expenses, { required: false })),
    emergencySavings: c.take("emergencySavings", parseAmount(form.emergencySavings)) as Cents,
    freeSavings: c.take("freeSavings", parseAmount(form.freeSavings)) as Cents,
    loanBalances,
    goalBalances,
    frozen: null,
  });
}

export interface GoalForm {
  name: string;
  target: string;
  deadlineMonth: string;
  alreadySaved: string;
}

/**
 * A savings goal (SPEC D23): name, target > 0 (0 allowed for the primary goal: no target yet),
 * deadline month not in the past, amount already saved ≥ 0. A goal may keep the past deadline it
 * already has (« Date limite dépassée » is then a warning, D10); only a new one is refused.
 */
export function validateGoal(
  form: GoalForm,
  {
    currentMonth,
    primary = false,
    savedDeadline,
  }: { currentMonth: YearMonth; primary?: boolean; savedDeadline?: YearMonth },
): Validated<SavingsGoalDraft> {
  const c = new Collector();
  const name = form.name.trim();
  if (name === "") c.fail("name", "Nom requis");
  else if (name.length > 100) c.fail("name", "100 caractères maximum");
  const target = c.take("target", parseAmount(form.target)) as Cents;
  if (target === 0 && !primary) c.fail("target", "L’objectif doit être supérieur à 0");
  const deadlineMonth = c.take("deadlineMonth", parseMonth(form.deadlineMonth));
  if (deadlineMonth && deadlineMonth !== savedDeadline && compareMonths(deadlineMonth, currentMonth) < 0) {
    c.fail("deadlineMonth", "La date limite est déjà passée");
  }
  const alreadySaved = c.take("alreadySaved", parseAmount(form.alreadySaved)) as Cents;
  return c.result({ name, target, deadlineMonth, alreadySaved });
}
