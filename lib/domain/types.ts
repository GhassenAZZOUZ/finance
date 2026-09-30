import type { Cents, YearMonth } from "@/lib/engine";

export const BUDGET_CATEGORIES = ["income", "fixed", "variable"] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const MAX_ACTIVE_LOANS = 6;
/** Savings goals, the primary one included (SPEC D23). */
export const MAX_GOALS = 6;

export interface BudgetLine {
  id: string;
  category: BudgetCategory;
  label: string;
  amount: Cents;
  position: number;
  /** Optional period (SPEC D15): first / last month the line applies, inclusive. */
  startMonth: YearMonth | null;
  endMonth: YearMonth | null;
  /** « Non indexé » when false (SPEC D27); omitted = indexed. */
  indexed?: boolean;
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
  /** « Non indexé » when false (SPEC D27); omitted = indexed. */
  indexed?: boolean;
}

/** Plan parameters. The savings goals, the primary one included, are `SavingsGoal`s (SPEC D23). */
export interface BudgetSettings {
  startMonth: YearMonth;
  emergencyTarget: Cents;
  emergencyExisting: Cents;
  /** Free savings already available at the plan start (SPEC D16). */
  freeSavingsExisting: Cents;
  riskFreeRate: number;
  earlyRepaymentPct: number;
  /** Yearly indexation every January (SPEC D27), fractions from −1 to 1; omitted = 0. */
  expenseInflationRate?: number;
  incomeGrowthRate?: number;
  /** Yearly interest rates of the emergency fund and free savings (SPEC D28), fractions; omitted = 0. */
  emergencyRate?: number;
  freeSavingsRate?: number;
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
  /** Early-repayment penalty (IRA, SPEC D22): fraction of the capital repaid early; null = none. */
  penaltyPct: number | null;
  /** Optional cap in months of interest on the capital repaid early; null = no cap. */
  penaltyCapMonths: number | null;
  /**
   * "overdraft" (SPEC D24): `principal` = balance used (≥ 0), `monthlyPayment` = optional fixed
   * repayment (≥ 0), `creditLimit` = authorised amount; no IRA, contract end or read month.
   */
  kind: "loan" | "overdraft";
  /** Overdraft only (> 0); null for a loan. */
  creditLimit: Cents | null;
  position: number;
  archivedAt: string | null;
}

export type LoanDraft = Omit<Loan, "id" | "position" | "archivedAt">;

/**
 * A savings goal (SPEC D23). Exactly one goal is `primary` (the spreadsheet's moving fund) as soon as
 * there is one; it is deleted only by handing the flag to another goal. Its target may be 0.
 */
export interface SavingsGoal {
  id: string;
  name: string;
  target: Cents;
  deadlineMonth: YearMonth;
  alreadySaved: Cents;
  /** 1 = filled first; unique and contiguous across all goals. */
  priority: number;
  primary: boolean;
  /** Yearly interest rate of the goal's savings (SPEC D28), fraction; omitted = 0. */
  rate?: number;
}

export type SavingsGoalDraft = Pick<SavingsGoal, "name" | "target" | "deadlineMonth" | "alreadySaved" | "rate">;

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
  emergencySavings: Cents;
  freeSavings: Cents;
  loanBalances: { loanId: string; balance: Cents }[];
  /** Balance of each savings goal, the primary one included (SPEC D23). */
  goalBalances: { goalId: string; balance: Cents }[];
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
  /** Priority order, the primary goal included (SPEC D23). */
  goals: SavingsGoal[];
  /** Oldest first. */
  actuals: MonthlyActual[];
  /** Monthly check-in reminder by e-mail (SPEC D25); on by default. */
  reminderEnabled: boolean;
}
