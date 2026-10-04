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
  /** « Non indexé » (SPEC D27): false keeps the entered amount in every year; omitted = indexed. */
  indexed?: boolean;
}

/**
 * A savings goal (SPEC D23). Goals are filled in array order (priority 1 first), each up to its
 * target and only until its deadline month, before the emergency fund.
 */
export interface GoalInput {
  /** "moving" for the primary goal (the spreadsheet's moving fund). */
  id: string;
  name: string;
  target: Cents;
  /** Last month that can still receive savings (inclusive). */
  deadlineMonth: YearMonth;
  alreadySaved: Cents;
  /** Yearly interest rate of the goal's savings (SPEC D28), fraction; 0 or omitted = none. */
  rate?: number;
}

/** Id of the primary goal (the spreadsheet's moving fund, SPEC D23). */
export const PRIMARY_GOAL_ID = "moving";

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
  /** Name of the moving fund when it is the only goal; "Déménagement" (the spreadsheet's) when omitted. */
  movingName?: string;
  emergencyTarget: Cents;
  emergencyExisting: Cents;
  /** Free savings already available at the plan start (SPEC D16); 0 when omitted. */
  freeSavingsExisting?: Cents;
  /**
   * Yearly interest rates of the savings (SPEC D28), fractions; 0 or omitted = none. Interest accrues
   * monthly and is credited on 31 December (and in the last plan month).
   */
  emergencyRate?: number;
  freeSavingsRate?: number;
  /** Rate of the moving fund when it is the only goal (no `goals`). */
  movingRate?: number;
  /** Fraction, e.g. 0.024 for 2.4 %. A loan is eligible for early repayment if apr > riskFreeRate. */
  riskFreeRate: number;
  /** Fraction 0..1 of the monthly remainder sent to early repayment. */
  earlyRepaymentPct: number;
  /** One-off exceptions; months outside the plan are ignored. Never indexed (SPEC D27). */
  exceptions?: readonly BudgetExceptionInput[];
  /**
   * Yearly indexation (SPEC D27), fractions from −1 to 1: every January, fixed and variable lines
   * grow by `expenseInflationRate` and income lines by `incomeGrowthRate`. 0 or omitted = constant.
   */
  expenseInflationRate?: number;
  incomeGrowthRate?: number;
  /**
   * Budget lines with optional periods (SPEC D15). When present, each month's regular income and
   * expenses are the sums of the lines active that month; `income`, `fixedCosts` and
   * `variableExpenses` then only describe the reference month used by the KPIs.
   */
  lines?: readonly DatedBudgetLineInput[];
  /**
   * Savings goals in priority order (SPEC D23), the primary one (id "moving") included. When
   * omitted, the single moving fund above is the only goal (the spreadsheet).
   */
  goals?: readonly GoalInput[];
}

/** One goal in one month (SPEC D23). */
export interface GoalMonth {
  toGoal: Cents;
  /** Interest credited to the goal this month (SPEC D28): December and the last month only. */
  interest: Cents;
  cumulative: Cents;
}

/** An active loan. Array order = entry order (breaks APR ties). */
export interface LoanInput {
  id: string;
  name: string | null;
  principal: Cents;
  /** Fraction, e.g. 0.189 for 18.9 %. */
  apr: number;
  monthlyPayment: Cents;
  /**
   * Early-repayment penalty (IRA, SPEC D22): fraction of the capital repaid early, e.g. 0.03.
   * 0 or omitted = no penalty (the avalanche is then exactly the spreadsheet's).
   */
  penaltyPct?: number;
  /** Optional cap: this many months of interest on the capital repaid early (French home loans: 6). */
  penaltyCapMonths?: number | null;
  /**
   * "overdraft" (SPEC D24): `principal` is the balance used, `monthlyPayment` an optional fixed
   * repayment (may be 0), `limit` the authorised amount. Omitted = an ordinary loan.
   */
  kind?: "loan" | "overdraft";
  /** Authorised overdraft (> 0); negative months draw on it up to this amount. */
  limit?: Cents;
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
  /** IRA paid on this month's early repayment (SPEC D22), taken from the early-repayment budget. */
  penalty: Cents;
  /** IRA on this month's extra repayment (#97): paid on top of it, from the same source. */
  extraPenalty: Cents;
  /** Overdraft only (SPEC D24): shortfall of a negative month added to the balance. */
  draw: Cents;
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
  /** Σ over the goals (the moving fund alone in the spreadsheet). */
  toMoving: Cents;
  movingCumulative: Cents;
  /** Same order as the goals (SPEC D23). */
  goals: GoalMonth[];
  toEmergency: Cents;
  emergencyCumulative: Cents;
  remainder: Cents;
  toEarlyRepayment: Cents;
  unusedEarlyRepayment: Cents;
  toFreeSavings: Cents;
  /**
   * Savings interest credited this month (SPEC D28), in December and the last plan month only:
   * to the goals, to the emergency fund (up to its target) and to free savings (their own interest
   * plus the emergency fund's above its target). Included in the cumulative columns.
   */
  emergencyInterest: Cents;
  freeSavingsInterest: Cents;
  /** Σ of the goals', the emergency fund's and free savings' interest. */
  savingsInterest: Cents;
  freeSavingsCumulative: Cents;
  remainingDebt: Cents;
  negativeBudget: boolean;
  /** Every goal has reached its target. */
  movingReached: boolean;
  emergencyReached: boolean;
  debtFree: boolean;
  /** Same order as `PlanInput.loans`. */
  loans: LoanMonth[];
  totalEarlyRepayment: Cents;
  /** Σ penalty of the loans (SPEC D22). */
  totalPenalty: Cents;
  /** Σ extraPenalty of the loans (#97), not taken from the early-repayment budget. */
  totalExtraPenalty: Cents;
  /** Σ overdraft draws of a negative month (SPEC D24); the rest of the shortfall is dropped. */
  overdraftDraw: Cents;
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
  /** "overdraft": reusable, never a payoff milestone (SPEC D24). */
  kind: "loan" | "overdraft";
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
  /** Σ IRA paid on this loan's early repayments (SPEC D22). */
  penaltiesPaid: Cents;
  /** The first month's payment does not cover the interest: the balance grows (SPEC D10). */
  paymentBelowInterest: boolean;
}

export type DebtAlert = "ok" | "warning" | "alert";

/** Per-goal KPIs (SPEC D23), same rules as the moving fund's (§7). */
export interface GoalKpis {
  id: string;
  name: string;
  target: Cents;
  deadlineMonth: YearMonth;
  /** 0 when the deadline is before the start. */
  monthlyNeeded: Cents;
  deadlineBeforeStart: boolean;
  amountAtDeadline: Cents;
  /** Target reached by the deadline. */
  met: boolean;
  /** First month the target is reached; null = never (then « hors délai »). */
  reachedMonth: YearMonth | null;
}

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
  /** The moving* KPIs describe the primary goal (SPEC D23); `goals` has one entry per goal. */
  movingGoal: Cents;
  /** 0 when the deadline is before the start (UI: "Date limite dépassée"). */
  movingMonthlyNeeded: Cents;
  deadlineBeforeStart: boolean;
  movingAmountAtDeadline: Cents;
  movingGoalMet: boolean;
  movingReachedMonth: YearMonth | null;
  goals: GoalKpis[];
  emergencyTarget: Cents;
  emergencyReachedMonth: YearMonth | null;
  hasDebt: boolean;
  /** Null when there is no debt or it is not repaid within the horizon (see `hasDebt`). */
  debtFreeMonth: YearMonth | null;
  interestWithoutPlan: Cents;
  interestWithPlan: Cents;
  /** Net of penalties: interestWithoutPlan − interestWithPlan − penaltiesPaid (SPEC D22). */
  interestSaved: Cents;
  penaltiesPaid: Cents;
  freeSavingsAt12: Cents;
  /** Savings interest credited over the plan / over its first 12 months (SPEC D28). */
  savingsInterest: Cents;
  savingsInterestAt12: Cents;
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
