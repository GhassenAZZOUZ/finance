import type { Cents, YearMonth } from "@/lib/engine";
import type { SavingsDeposit } from "./deposits";
import type { CsvMapping } from "@/lib/import/bank-csv";
import type { BankRule } from "@/lib/import/bank-rules";
import type { ActualLine } from "./actual-lines";

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
  /**
   * Income lines (SPEC D29): usual payday, `paydayDay` (1–31, a day the month lacks = its last day)
   * of the previous month or of the month itself. Omitted = 1 of the same month.
   */
  paydayDay?: number;
  paydayPreviousMonth?: boolean;
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
  /**
   * Income lines (SPEC D29): usual payday, `paydayDay` (1–31, a day the month lacks = its last day)
   * of the previous month or of the month itself. Omitted = 1 of the same month.
   */
  paydayDay?: number;
  paydayPreviousMonth?: boolean;
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
  /** The sums of `lines` (#72); older check-ins: the totals typed then, or null. */
  income: Cents | null;
  expenses: Cents | null;
  /**
   * Actual amount of each budget line of the month, its exceptions and « hors budget » (#72), with
   * a copy of their label and budget; empty for check-ins saved before (« non détaillé »).
   */
  lines: ActualLine[];
  /**
   * What was put into / taken out of each savings pot that month (SPEC D33, #73). Empty or omitted
   * for check-ins saved before: their typed balances below are then kept as they are.
   */
  deposits?: SavingsDeposit[];
  /**
   * End-of-month balances. Computed from the deposits (`withComputedBalances`) once loaded; the typed
   * ones for check-ins saved before #73.
   */
  emergencySavings: Cents;
  freeSavings: Cents;
  loanBalances: { loanId: string; balance: Cents }[];
  /** Balance of each savings goal, the primary one included (SPEC D23). */
  goalBalances: { goalId: string; balance: Cents }[];
  /** Null for check-ins saved before D16 (compared with the current plan). */
  frozen: FrozenPlan | null;
  /** Starting values corrected by hand when the plan was re-based from this check-in (#100). */
  rebaseCorrections?: RebaseCorrection[];
  /**
   * Bank statements added to this month's rows (#115): a summary each, never a transaction. Omitted
   * in a draft: the saved ones are kept.
   */
  statements?: BankStatement[];
}

/** A named bank account (#115); its CSV column mapping is reused for its next statements. */
export interface BankAccount {
  id: string;
  name: string;
  /** Null: a Revolut account (recognised from its header) or not mapped yet. */
  mapping: CsvMapping | null;
}

/** What one imported statement added to a month (#115, SPEC D30): enough to subtract it later. */
export interface BankStatement {
  /** Null once the account is deleted; `accountName` stays. */
  accountId: string | null;
  accountName: string;
  fileName: string;
  /** Hash of the month's transactions (date, label, amount), to refuse the same statement twice. */
  fingerprint: string;
  transactionCount: number;
  totalIn: Cents;
  totalOut: Cents;
  /** Amount added to each budget line's row (income received, money spent; refunds lower it). */
  lineTotals: { budgetLineId: string; actual: Cents }[];
}

/** A re-base starting value corrected by hand in the preview (#100): what the check-in read, what was used. */
export interface RebaseCorrection {
  label: string;
  read: Cents;
  used: Cents;
}

/** The latest re-base, while it can still be undone (#100). */
export interface RebaseUndo {
  fromMonth: YearMonth;
  newStartMonth: YearMonth;
}

export type MonthlyActualDraft = Omit<MonthlyActual, "id" | "rebaseCorrections">;

/** Actual date an income line was paid for a month, when it differs from its usual payday (SPEC D29). */
export interface IncomePayment {
  /** The month whose budget the income funds. */
  month: YearMonth;
  budgetLineId: string;
  /** YYYY-MM-DD, from the 1st of the month before to the last day of `month`, never after today. */
  paidOn: string;
}

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
  /** Per-month exceptions to the income lines' paydays (SPEC D29), by month. */
  incomePayments: IncomePayment[];
  /** Column mapping of the user's bank CSV export (SPEC D30); null or omitted = none saved. */
  bankCsvMapping?: CsvMapping | null;
  /** Keyword rules learnt from bank imports, and each imported month's total per line (SPEC D31). */
  bankRules?: BankRule[];
  /** Named bank accounts, each with its own CSV mapping (#115). */
  bankAccounts?: BankAccount[];
  /** The latest re-base while it can be undone (#100); null or omitted = nothing to undo. */
  rebaseUndo?: RebaseUndo | null;
}
