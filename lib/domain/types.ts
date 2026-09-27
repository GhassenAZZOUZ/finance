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
  /** Optional period (SPEC D15): first / last month the line applies, inclusive. */
  startMonth: YearMonth | null;
  endMonth: YearMonth | null;
}

/** A line as edited in the form: no id yet for new lines. */
export interface BudgetLineDraft {
  id?: string;
  category: BudgetCategory;
  label: string;
  amount: Cents;
  position: number;
  startMonth: YearMonth | null;
  endMonth: YearMonth | null;
}

export interface BudgetSettings {
  startMonth: YearMonth;
  movingGoal: Cents;
  movingDeadlineMonth: YearMonth;
  movingAlreadySaved: Cents;
  emergencyTarget: Cents;
  emergencyExisting: Cents;
  /** Free savings already available at the plan start (SPEC D16). */
  freeSavingsExisting: Cents;
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

/** Extra income or extra expenses for a single month (SPEC D14). */
export interface BudgetException {
  id: string;
  month: YearMonth;
  kind: "income" | "expense";
  label: string;
  /** > 0 */
  amount: Cents;
}

export type BudgetExceptionDraft = Omit<BudgetException, "id">;

/** The plan's expectation frozen with a check-in (SPEC D16). */
export interface FrozenPlan {
  plannedDebt: Cents;
  plannedSavings: Cents;
  plannedIncome: Cents;
  plannedExpenses: Cents;
  /** Start month of the plan it was compared with. */
  planStartMonth: YearMonth;
}

export interface MonthlyActual {
  id: string;
  month: YearMonth;
  income: Cents | null;
  expenses: Cents | null;
  movingSavings: Cents;
  emergencySavings: Cents;
  freeSavings: Cents;
  loanBalances: { loanId: string; balance: Cents }[];
  /** Null for check-ins saved before D16 (compared with the current plan). */
  frozen: FrozenPlan | null;
}

export type MonthlyActualDraft = Omit<MonthlyActual, "id">;

/** Everything the pages need for one user. */
export interface FinanceSnapshot {
  settings: BudgetSettings | null;
  lines: BudgetLine[];
  /** One-off exceptions, by month. */
  exceptions: BudgetException[];
  /** Active loans, in entry order. */
  loans: Loan[];
  archivedLoans: Loan[];
  /** Oldest first. */
  actuals: MonthlyActual[];
}
