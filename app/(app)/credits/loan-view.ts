/**
 * Pure view-model for the /credits page: rows, totals and form parsing. No React, no I/O,
 * so it is unit-tested (tests/unit/credits-*.test.ts) and safe to import from client code.
 */
import type { ComputedPlan } from "@/lib/domain/plan";
import type { Loan } from "@/lib/domain/types";
import type { LoanForm } from "@/lib/domain/validation";
import { type Cents, type LoanAdvice, type YearMonth, roundHalfAwayFromZero, sumCents } from "@/lib/engine";
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
}

export interface LoanRow {
  id: string;
  displayName: string;
  type: string | null;
  principal: Cents;
  apr: number;
  monthlyPayment: Cents;
  paymentBelowInterest: boolean;
  derived: LoanDerived | null;
  /** Pre-filled values for the edit form. */
  form: LoanForm;
}

export interface LoanTotals {
  totalPrincipal: Cents;
  weightedApr: number;
  monthlyPayments: Cents;
}

export const EMPTY_LOAN_FORM: LoanForm = { name: "", type: "", principal: "", apr: "", monthlyPayment: "" };

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
  };
}

/** Active loans in entry order; `plan.result.loans` follows the same order (matched by id to be safe). */
export function buildLoanRows(loans: readonly Loan[], plan: ComputedPlan | null): LoanRow[] {
  const summaries = new Map((plan?.result.loans ?? []).map((s) => [s.id, s]));
  return loans.map((loan, i) => {
    const s = summaries.get(loan.id);
    return {
      id: loan.id,
      displayName: s?.displayName ?? loanDisplayName(loan, i),
      type: loan.type,
      principal: loan.principal,
      apr: loan.apr,
      monthlyPayment: loan.monthlyPayment,
      paymentBelowInterest: s?.paymentBelowInterest ?? isPaymentBelowInterest(loan),
      derived: s
        ? {
            eligible: s.eligible,
            priority: s.priority,
            advice: s.advice,
            payoffMonthWithPlan: s.payoffMonthWithPlan,
            payoffMonthWithoutPlan: s.payoffMonthWithoutPlan,
            interestWithPlan: s.interestWithPlan,
            interestWithoutPlan: s.interestWithoutPlan,
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
  };
}

/** Loan id from the hidden field; "" means "new loan". */
export function readLoanId(formData: FormData): string {
  return text(formData, "id").trim();
}
