/**
 * Pure view-model for the /credits page: rows, totals and form parsing. No React, no I/O,
 * so it is unit-tested (tests/unit/credits-*.test.ts) and safe to import from client code.
 */
import type { ComputedPlan } from "@/lib/domain/plan";
import type { Loan } from "@/lib/domain/types";
import type { LoanForm } from "@/lib/domain/validation";
import {
  type Cents,
  type LoanAdvice,
  type YearMonth,
  addMonths,
  monthsBetween,
  paymentsBeforeStart,
  paymentsUntilRepaid,
  roundHalfAwayFromZero,
  sumCents,
} from "@/lib/engine";
import { amountInputValue, percentInputValue } from "@/lib/format";

/** Values only known once the budget exists (the engine needs it to simulate the plan). */
export interface LoanDerived {
  eligible: boolean;
  priority: number | null;
  advice: LoanAdvice;
  payoffMonthWithPlan: YearMonth | null;
  payoffMonthWithoutPlan: YearMonth | null;
  interestWithPlan: Cents;
  interestWithoutPlan: Cents;
  /** IRA paid on this loan's early repayments in the plan (SPEC D22). */
  penaltiesPaid: Cents;
}

export interface LoanRow {
  id: string;
  displayName: string;
  type: string | null;
  /** As entered (read after the payment of `principalPaidThroughMonth`). */
  principal: Cents;
  principalPaidThroughMonth: YearMonth | null;
  /** Projected principal at the plan start, when a plan exists and it differs from `principal` (SPEC D5c). */
  principalAtStart: { month: YearMonth; amount: Cents } | null;
  /** The principal was read after the plan start: it is used as is (cannot be projected backwards). */
  principalReadAfterStart: YearMonth | null;
  /** Month of the last payment when the loan is fully repaid before the plan start (SPEC D5c). */
  paidOffBeforeStart: YearMonth | null;
  apr: number;
  monthlyPayment: Cents;
  paymentBelowInterest: boolean;
  contractEndMonth: YearMonth | null;
  /** IRA (SPEC D22): fraction of the capital repaid early, and optional cap in months of interest. */
  penaltyPct: number | null;
  penaltyCapMonths: number | null;
  /** "overdraft": reusable debt with a limit and an optional fixed repayment (SPEC D24). */
  kind: "loan" | "overdraft";
  creditLimit: Cents | null;
  /** Contract end vs simulated end, when both are known (SPEC D5b). */
  endCheck: ContractEndCheck | null;
  derived: LoanDerived | null;
  /** Pre-filled values for the edit form. */
  form: LoanForm;
}

export interface LoanTotals {
  totalPrincipal: Cents;
  weightedApr: number;
  monthlyPayments: Cents;
}

export const EMPTY_LOAN_FORM: LoanForm = {
  name: "",
  type: "",
  principal: "",
  apr: "",
  monthlyPayment: "",
  contractEndMonth: "",
  principalPaidThroughMonth: "",
  penaltyPct: "",
  penaltyCapMonths: "",
  kind: "loan",
  creditLimit: "",
};

/** Tolerated difference between the contract end and the simulated end (rounding of the last payment). */
export const CONTRACT_END_TOLERANCE_MONTHS = 1;

export interface ContractEndCheck {
  contractEndMonth: YearMonth;
  /** End with normal payments only; null = beyond the 25-year horizon. */
  simulatedEndMonth: YearMonth | null;
  /** simulated − contract, in months; null when the loan never ends within the horizon. */
  gapMonths: number | null;
  consistent: boolean;
}

/**
 * Compares the contract end month with the end the engine simulates from the capital, APR and
 * monthly payment without early repayment. The contract assumes normal payments, hence "sans plan".
 * `simulatedEndMonth` undefined = no plan yet (no budget): nothing to compare.
 */
export function checkContractEnd(
  contractEndMonth: YearMonth | null,
  simulatedEndMonth: YearMonth | null | undefined,
): ContractEndCheck | null {
  if (!contractEndMonth || simulatedEndMonth === undefined) return null;
  const gapMonths = simulatedEndMonth === null ? null : monthsBetween(contractEndMonth, simulatedEndMonth);
  return {
    contractEndMonth,
    simulatedEndMonth,
    gapMonths,
    consistent: gapMonths !== null && Math.abs(gapMonths) <= CONTRACT_END_TOLERANCE_MONTHS,
  };
}

/** Same fallback as the engine: "Crédit n", n = 1-based position among active loans. */
export function loanDisplayName(loan: Pick<Loan, "name">, index: number): string {
  const name = loan.name?.trim();
  return name ? name : `Crédit ${index + 1}`;
}

/** SPEC D10: the first month's payment does not cover the interest. */
export function isPaymentBelowInterest(loan: Pick<Loan, "principal" | "apr" | "monthlyPayment">): boolean {
  return loan.principal > 0 && loan.monthlyPayment <= roundHalfAwayFromZero((loan.principal * loan.apr) / 12);
}

export function loanToForm(loan: Loan): LoanForm {
  return {
    name: loan.name ?? "",
    type: loan.type ?? "",
    principal: amountInputValue(loan.principal),
    apr: percentInputValue(loan.apr),
    monthlyPayment: amountInputValue(loan.monthlyPayment),
    contractEndMonth: loan.contractEndMonth ?? "",
    principalPaidThroughMonth: loan.principalPaidThroughMonth ?? "",
    penaltyPct: loan.penaltyPct ? percentInputValue(loan.penaltyPct) : "",
    penaltyCapMonths: loan.penaltyPct && loan.penaltyCapMonths !== null ? String(loan.penaltyCapMonths) : "",
    kind: loan.kind,
    creditLimit: amountInputValue(loan.creditLimit),
  };
}

/** Month of the payment that repaid the loan during the projection to the plan start, if any. */
function repaidMonth(loan: Loan, startMonth: YearMonth): YearMonth | null {
  if (!loan.principalPaidThroughMonth || loan.principal <= 0) return null;
  const n = paymentsUntilRepaid(
    loan.principal,
    loan.apr,
    loan.monthlyPayment,
    paymentsBeforeStart(loan.principalPaidThroughMonth, startMonth),
  );
  return n === null || n === 0 ? null : addMonths(loan.principalPaidThroughMonth, n);
}

/** Active loans in entry order; `plan.result.loans` follows the same order (matched by id to be safe). */
export function buildLoanRows(loans: readonly Loan[], plan: ComputedPlan | null): LoanRow[] {
  const summaries = new Map((plan?.result.loans ?? []).map((s) => [s.id, s]));
  const startPrincipals = new Map((plan?.input.loans ?? []).map((l) => [l.id, l.principal]));
  const startMonth = plan?.input.budget.startMonth ?? null;
  return loans.map((loan, i) => {
    const s = summaries.get(loan.id);
    const atStart = startPrincipals.get(loan.id);
    const paidThrough = loan.principalPaidThroughMonth;
    const paidOffBeforeStart = startMonth && atStart === 0 ? repaidMonth(loan, startMonth) : null;
    return {
      id: loan.id,
      displayName: s?.displayName ?? loanDisplayName(loan, i),
      type: loan.type,
      principal: loan.principal,
      principalPaidThroughMonth: paidThrough,
      principalAtStart:
        startMonth && atStart !== undefined && atStart !== loan.principal && !paidOffBeforeStart
          ? { month: startMonth, amount: atStart }
          : null,
      paidOffBeforeStart,
      principalReadAfterStart:
        startMonth && paidThrough && paymentsBeforeStart(paidThrough, startMonth) < 0 ? startMonth : null,
      apr: loan.apr,
      monthlyPayment: loan.monthlyPayment,
      paymentBelowInterest: s?.paymentBelowInterest ?? isPaymentBelowInterest(loan),
      contractEndMonth: loan.contractEndMonth,
      penaltyPct: loan.penaltyPct,
      penaltyCapMonths: loan.penaltyCapMonths,
      kind: loan.kind,
      creditLimit: loan.creditLimit,
      endCheck: checkContractEnd(loan.contractEndMonth, s ? (paidOffBeforeStart ?? s.payoffMonthWithoutPlan) : undefined),
      derived: s
        ? {
            eligible: s.eligible,
            priority: s.priority,
            advice: s.advice,
            payoffMonthWithPlan: s.payoffMonthWithPlan,
            payoffMonthWithoutPlan: s.payoffMonthWithoutPlan,
            interestWithPlan: s.interestWithPlan,
            interestWithoutPlan: s.interestWithoutPlan,
            penaltiesPaid: s.penaltiesPaid,
          }
        : null,
      form: loanToForm(loan),
    };
  });
}

/** SPEC §5 totals. Uses the engine KPIs when the plan exists, else computes them from the loans. */
export function computeLoanTotals(loans: readonly Loan[], plan: ComputedPlan | null): LoanTotals {
  if (plan) {
    const k = plan.result.kpis;
    return { totalPrincipal: k.totalPrincipal, weightedApr: k.weightedApr, monthlyPayments: k.monthlyLoanPayments };
  }
  const totalPrincipal = sumCents(loans.map((l) => l.principal));
  const weightedApr = totalPrincipal > 0 ? loans.reduce((acc, l) => acc + l.principal * l.apr, 0) / totalPrincipal : 0;
  return { totalPrincipal, weightedApr, monthlyPayments: sumCents(loans.map((l) => l.monthlyPayment)) };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Reads the loan form fields; missing or non-text fields become "". */
export function readLoanForm(formData: FormData): LoanForm {
  return {
    name: text(formData, "name"),
    type: text(formData, "type"),
    principal: text(formData, "principal"),
    apr: text(formData, "apr"),
    monthlyPayment: text(formData, "monthlyPayment"),
    contractEndMonth: text(formData, "contractEndMonth"),
    principalPaidThroughMonth: text(formData, "principalPaidThroughMonth"),
    penaltyPct: text(formData, "penaltyPct"),
    penaltyCapMonths: text(formData, "penaltyCapMonths"),
    kind: text(formData, "kind") === "overdraft" ? "overdraft" : "loan",
    creditLimit: text(formData, "creditLimit"),
  };
}

/** Loan id from the hidden field; "" means "new loan". */
export function readLoanId(formData: FormData): string {
  return text(formData, "id").trim();
}

/** Rows in early-repayment order: eligible loans by priority, then the others by APR (highest first). */
export function sortByPriority(rows: readonly LoanRow[]): LoanRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.derived?.priority ?? null;
    const pb = b.derived?.priority ?? null;
    if (pa !== null && pb !== null) return pa - pb;
    if (pa !== null) return -1;
    if (pb !== null) return 1;
    return b.apr - a.apr;
  });
}

/** Months saved by the plan on this loan's payoff (without − with), null when unknown or beyond 25 years. */
export function payoffGain(derived: Pick<LoanDerived, "payoffMonthWithPlan" | "payoffMonthWithoutPlan">): number | null {
  const { payoffMonthWithPlan: withPlan, payoffMonthWithoutPlan: without } = derived;
  return withPlan && without ? monthsBetween(withPlan, without) : null;
}

export interface TimelineScale {
  start: YearMonth;
  /** Number of months drawn (≥ 12). */
  months: number;
}

/** Time axis of the payoff timelines: from the plan start to the latest payoff without the plan (+1 month). */
export function timelineScale(rows: readonly LoanRow[], startMonth: YearMonth): TimelineScale {
  let months = 12;
  for (const row of rows) {
    if (row.kind === "overdraft") continue; // no timeline (D24)
    for (const m of [row.derived?.payoffMonthWithPlan, row.derived?.payoffMonthWithoutPlan]) {
      if (m) months = Math.max(months, monthsBetween(startMonth, m) + 2);
    }
  }
  return { start: startMonth, months };
}

/** Position (0..1) of the middle of `month` on the scale, clamped. */
export function timelinePosition(scale: TimelineScale, month: YearMonth): number {
  return Math.min(1, Math.max(0, (monthsBetween(scale.start, month) + 0.5) / scale.months));
}
