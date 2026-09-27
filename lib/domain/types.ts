import type { Cents, YearMonth } from "@/lib/engine";

export const BUDGET_CATEGORIES = ["income", "fixed", "variable"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const MAX_ACTIVE_LOANS = 6;

export interface BudgetLine {
  id: string;
  category: BudgetCategory;
  label: string;
  amount: Cents;
  position: number;
}

/** A line as edited in the form: no id yet for new lines. */
export interface BudgetLineDraft {
  id?: string;
  category: BudgetCategory;
  label: string;
  amount: Cents;
  position: number;
}

export interface BudgetSettings {
  startMonth: YearMonth;
  movingGoal: Cents;
  movingDeadlineMonth: YearMonth;
  movingAlreadySaved: Cents;
  emergencyTarget: Cents;
  emergencyExisting: Cents;
  riskFreeRate: number;
  earlyRepaymentPct: number;
}

export interface Loan {
  id: string;
  name: string | null;
  type: string | null;
  /** Remaining principal as read by the user, after the payment of `principalPaidThroughMonth`. */
  principal: Cents;
  /** Last payment already made when `principal` was read; null = principal at the plan start (SPEC D5c). */
  principalPaidThroughMonth: YearMonth | null;
  apr: number;
  monthlyPayment: Cents;
  /** Optional contract end month, for a consistency check only (SPEC D5b). */
  contractEndMonth: YearMonth | null;
  position: number;
  archivedAt: string | null;
}

export type LoanDraft = Omit<Loan, "id" | "position" | "archivedAt">;

export interface MonthlyActual {
  id: string;
  month: YearMonth;
  income: Cents | null;
  expenses: Cents | null;
  movingSavings: Cents;
  emergencySavings: Cents;
  freeSavings: Cents;
  loanBalances: { loanId: string; balance: Cents }[];
}

export type MonthlyActualDraft = Omit<MonthlyActual, "id">;

/** Everything the pages need for one user. */
export interface FinanceSnapshot {
  settings: BudgetSettings | null;
  lines: BudgetLine[];
  /** Active loans, in entry order. */
  loans: Loan[];
  archivedLoans: Loan[];
  /** Oldest first. */
  actuals: MonthlyActual[];
}
