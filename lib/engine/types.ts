import type { Cents } from "./money";
import type { YearMonth } from "./months";

/** Number of simulated months (25 years), as in the spreadsheet. */
export const HORIZON_MONTHS = 300;

/** Extra income or extra expenses for a single month, on top of the regular budget (SPEC D14). */
export interface BudgetExceptionInput {
  month: YearMonth;
  kind: "income" | "expense";
  /** > 0 */
  amount: Cents;
}

/** A budget line that may apply only from and/or until a given month (SPEC D15). */
export interface DatedBudgetLineInput {
  category: "income" | "fixed" | "variable";
  amount: Cents;
  /** First month the line applies (inclusive); null = from the start. */
  startMonth: YearMonth | null;
  /** Last month the line applies (inclusive); null = no end. */
  endMonth: YearMonth | null;
}

/** Budget inputs. The engine only needs the three sums (SPEC D9) plus one-off exceptions (D14). */
export interface BudgetParams {
  income: Cents;
  fixedCosts: Cents;
  variableExpenses: Cents;
  startMonth: YearMonth;
  movingGoal: Cents;
  /** Last month that can still receive moving savings (inclusive). */
  movingDeadlineMonth: YearMonth;
  movingAlreadySaved: Cents;
  emergencyTarget: Cents;
  emergencyExisting: Cents;
  /** Free savings already available at the plan start (SPEC D16); 0 when omitted. */
  freeSavingsExisting?: Cents;
  /** Fraction, e.g. 0.024 for 2.4 %. A loan is eligible for early repayment if apr > riskFreeRate. */
  riskFreeRate: number;
  /** Fraction 0..1 of the monthly remainder sent to early repayment. */
  earlyRepaymentPct: number;
  /** One-off exceptions; months outside the plan are ignored. */
  exceptions?: readonly BudgetExceptionInput[];
  /**
   * Budget lines with optional periods (SPEC D15). When present, each month's regular income and
   * expenses are the sums of the lines active that month; `income`, `fixedCosts` and
   * `variableExpenses` then only describe the reference month used by the KPIs.
   */
  lines?: readonly DatedBudgetLineInput[];
}

/** An active loan. Array order = entry order (breaks APR ties). */
export interface LoanInput {
  id: string;
  name: string | null;
  principal: Cents;
  /** Fraction, e.g. 0.189 for 18.9 %. */
  apr: number;
  monthlyPayment: Cents;
}

/**
 * A one-off extra repayment on one loan (SPEC D17, "Et si…" simulator only): paid after that
 * month's normal payment and before the avalanche, capped at the loan's remaining balance.
 */
export interface ExtraRepaymentInput {
  month: YearMonth;
  /** `LoanInput.id`; unknown ids are ignored. */
  loanId: string;
  /** > 0 */
  amount: Cents;
  /** "freeSavings": taken from the cumulative free savings; "external": money from outside the plan. */
  source: "freeSavings" | "external";
}

export interface PlanInput {
  budget: BudgetParams;
  loans: readonly LoanInput[];
  /** One-off extra repayments (SPEC D17); months outside the plan are ignored. */
  extraRepayments?: readonly ExtraRepaymentInput[];
}

/** One loan in one month (spreadsheet `Calcul` block). */
export interface LoanMonth {
  startBalance: Cents;
  interest: Cents;
  paymentPaid: Cents;
  balanceAfterPayment: Cents;
  /** One-off extra repayment applied this month (SPEC D17), before the avalanche. */
  extraRepayment: Cents;
  earlyRepayment: Cents;
  endBalance: Cents;
  baselineInterest: Cents;
  baselineEndBalance: Cents;
}

/** One row of the spreadsheet `Plan` sheet. */
export interface PlanMonth {
  /** 1-based month number. */
  index: number;
  month: YearMonth;
  /** Regular income + this month's income exceptions. */
  income: Cents;
  /** Regular fixed + variable expenses + this month's expense exceptions. */
  expenses: Cents;
  /** Part of `income` / `expenses` coming from one-off exceptions (SPEC D14). */
  extraIncome: Cents;
  extraExpenses: Cents;
  loanPayments: Cents;
  available: Cents;
  toMoving: Cents;
  movingCumulative: Cents;
  toEmergency: Cents;
  emergencyCumulative: Cents;
  remainder: Cents;
  toEarlyRepayment: Cents;
  unusedEarlyRepayment: Cents;
  toFreeSavings: Cents;
  freeSavingsCumulative: Cents;
  remainingDebt: Cents;
  negativeBudget: boolean;
  movingReached: boolean;
  emergencyReached: boolean;
  debtFree: boolean;
  /** Same order as `PlanInput.loans`. */
  loans: LoanMonth[];
  totalEarlyRepayment: Cents;
  /** Σ extraRepayment of the loans (SPEC D17). */
  totalExtraRepayment: Cents;
  /** Part of `totalExtraRepayment` taken from the free savings (deducted from `freeSavingsCumulative`). */
  extraFromFreeSavings: Cents;
  totalInterest: Cents;
  totalBaselineInterest: Cents;
}

export type LoanAdvice = "highRate" | "worthIt" | "keep";

export interface LoanSummary {
  id: string;
  /** `name`, or "Crédit n" (n = 1-based position) when empty. */
  displayName: string;
  eligible: boolean;
  /** 1 = first to receive early repayment; null when not eligible. */
  priority: number | null;
  advice: LoanAdvice;
  /** First month with a balance ≤ 0.01 €, or null if beyond the horizon. */
  payoffMonthWithPlan: YearMonth | null;
  payoffMonthWithoutPlan: YearMonth | null;
  interestWithPlan: Cents;
  interestWithoutPlan: Cents;
  /** The first month's payment does not cover the interest: the balance grows (SPEC D10). */
  paymentBelowInterest: boolean;
}

export type DebtAlert = "ok" | "warning" | "alert";

export interface PlanKpis {
  monthlyIncome: Cents;
  monthlyExpenses: Cents;
  monthlyLoanPayments: Cents;
  margin: Cents;
  /** monthlyLoanPayments / monthlyIncome; 0 when income is 0 (UI shows "—"). */
  debtRatio: number;
  debtAlert: DebtAlert;
  totalPrincipal: Cents;
  weightedApr: number;
  movingGoal: Cents;
  /** 0 when the deadline is before the start (UI: "Date limite dépassée"). */
  movingMonthlyNeeded: Cents;
  deadlineBeforeStart: boolean;
  movingAmountAtDeadline: Cents;
  movingGoalMet: boolean;
  movingReachedMonth: YearMonth | null;
  emergencyTarget: Cents;
  emergencyReachedMonth: YearMonth | null;
  hasDebt: boolean;
  /** Null when there is no debt or it is not repaid within the horizon (see `hasDebt`). */
  debtFreeMonth: YearMonth | null;
  interestWithoutPlan: Cents;
  interestWithPlan: Cents;
  interestSaved: Cents;
  freeSavingsAt12: Cents;
  emergencyFundAt12: Cents;
  remainingDebtAt12: Cents;
  negativeBudgetMonths: number;
}

export interface PlanResult {
  months: PlanMonth[];
  loans: LoanSummary[];
  kpis: PlanKpis;
}

/** Monthly check-in (SPEC §8). Balances are required; income/expenses are information only. */
export interface ActualInput {
  month: YearMonth;
  income: Cents | null;
  expenses: Cents | null;
  movingSavings: Cents;
  emergencySavings: Cents;
  freeSavings: Cents;
  /** Remaining principal per loan, as entered for that month. */
  loanBalances: readonly Cents[];
  /** Planned values frozen when the check-in was saved (SPEC D16); null = compare with the current plan. */
  planned?: PlannedSnapshot | null;
}

/** What the plan expected for a month, frozen with a check-in (SPEC D16). */
export interface PlannedSnapshot {
  debt: Cents;
  savings: Cents;
  income: Cents;
  expenses: Cents;
}

export type ActualStatus = "onTrack" | "late" | "mixed";

export interface ActualComparison {
  month: YearMonth;
  /** 1-based plan month, null when outside the plan horizon. */
  planIndex: number | null;
  actualDebt: Cents;
  plannedDebt: Cents | null;
  debtGap: Cents | null;
  actualSavings: Cents;
  plannedSavings: Cents | null;
  savingsGap: Cents | null;
  /** 0..1 */
  movingGoalPct: number;
  /** 0..1 */
  debtRepaidPct: number;
  status: ActualStatus | null;
  incomeGap: Cents | null;
  expensesGap: Cents | null;
}
