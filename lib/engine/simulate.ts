import { type Cents, roundHalfAwayFromZero, sumCents } from "./money";
import { addMonths, compareMonths, monthsBetween, type YearMonth } from "./months";
import { normalPayment } from "./payment";
import {
  HORIZON_MONTHS,
  type DatedBudgetLineInput,
  type DebtAlert,
  type LoanAdvice,
  type LoanInput,
  type LoanMonth,
  type LoanSummary,
  type PlanInput,
  type PlanKpis,
  type PlanMonth,
  type PlanResult,
} from "./types";

/** Whether a dated budget line applies in `month` (bounds inclusive; null = open). SPEC D15. */
export function isLineActive(line: Pick<DatedBudgetLineInput, "startMonth" | "endMonth">, month: YearMonth): boolean {
  return (
    (line.startMonth === null || compareMonths(line.startMonth, month) <= 0) &&
    (line.endMonth === null || compareMonths(month, line.endMonth) <= 0)
  );
}

/** A balance at or below this is considered repaid (spreadsheet: `<= 0.01`). */
const PAID_OFF_THRESHOLD: Cents = 1;
const HIGH_RATE_APR = 0.1;

/** Monthly interest in cents: ROUND(balance × apr / 12, 2) (SPEC §4.0, rounding point 1–2). */
function monthlyInterest(balance: Cents, apr: number): Cents {
  return roundHalfAwayFromZero((balance * apr) / 12);
}

/**
 * Early-repayment priorities (spreadsheet `Crédits!J:K`, SPEC §4.1): eligible when
 * apr > riskFreeRate (strict); rank by APR descending, ties by entry order. `null` = not eligible.
 */
export function computePriorities(loans: readonly LoanInput[], riskFreeRate: number): (number | null)[] {
  const eligible = loans.map((l) => l.principal > 0 && l.apr > riskFreeRate);
  return loans.map((loan, i) => {
    if (!eligible[i]) return null;
    let rank = 1;
    loans.forEach((other, j) => {
      if (!eligible[j]) return;
      if (other.apr > loan.apr || (other.apr === loan.apr && j < i)) rank += 1;
    });
    return rank;
  });
}

/** Penalty rate per euro repaid early: pct, capped at `capMonths` months of interest (SPEC D22). */
function penaltyRate(loan: LoanInput): number {
  const pct = loan.penaltyPct ?? 0;
  if (pct <= 0) return 0;
  const cap = loan.penaltyCapMonths;
  return cap === null || cap === undefined ? pct : Math.min(pct, (loan.apr / 12) * cap);
}

/** IRA on `repaid` cents: ROUND(min(pct × repaid, capMonths × repaid × apr / 12), 2) (SPEC §4.0 point 6). */
export function penaltyFor(loan: LoanInput, repaid: Cents): Cents {
  return repaid > 0 ? roundHalfAwayFromZero(repaid * penaltyRate(loan)) : 0;
}

/**
 * Months of normal payments left from `balance` (after this month's payment), without early
 * repayment; Infinity when the payment never covers the interest.
 */
function monthsToRepay(loan: LoanInput, balance: Cents): number {
  let left = balance;
  for (let n = 0; n < HORIZON_MONTHS * 2; n++) {
    if (left <= PAID_OFF_THRESHOLD) return n;
    const due = left + monthlyInterest(left, loan.apr);
    left = due - normalPayment(due, loan.monthlyPayment);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Worth repaying early despite the penalty (SPEC D22): each euro repaid now costs `penaltyRate`
 * and saves at least apr / 12 per remaining month of the loan; strict net gain required.
 */
function worthRepaying(loan: LoanInput, balance: Cents): boolean {
  const rate = penaltyRate(loan);
  return rate === 0 || rate < (loan.apr / 12) * monthsToRepay(loan, balance);
}

function adviceFor(loan: LoanInput, eligible: boolean): LoanAdvice {
  if (loan.apr >= HIGH_RATE_APR) return "highRate";
  return eligible ? "worthIt" : "keep";
}

function debtAlertFor(ratio: number): DebtAlert {
  if (ratio > 0.35) return "alert";
  if (ratio > 0.3) return "warning";
  return "ok";
}

export function simulatePlan(input: PlanInput): PlanResult {
  const { budget, loans } = input;
  const priorities = computePriorities(loans, budget.riskFreeRate);
  // Loan indexes in avalanche order (priority 1 first).
  const avalancheOrder = loans
    .map((_, i) => i)
    .filter((i) => priorities[i] !== null)
    .sort((a, b) => (priorities[a] as number) - (priorities[b] as number));

  const baseIncome = budget.income;
  const baseExpenses = budget.fixedCosts + budget.variableExpenses;
  // Regular budget of a month: constant, or the dated lines active that month (SPEC D15).
  const regularBudget = (month: YearMonth): { income: Cents; expenses: Cents } => {
    if (!budget.lines) return { income: baseIncome, expenses: baseExpenses };
    let income = 0;
    let expenses = 0;
    for (const line of budget.lines) {
      if (!isLineActive(line, month)) continue;
      if (line.category === "income") income += line.amount;
      else expenses += line.amount;
    }
    return { income, expenses };
  };
  // One-off exceptions summed per month (SPEC D14).
  const extras = new Map<YearMonth, { income: Cents; expenses: Cents }>();
  for (const e of budget.exceptions ?? []) {
    const x = extras.get(e.month) ?? { income: 0, expenses: 0 };
    if (e.kind === "income") x.income += e.amount;
    else x.expenses += e.amount;
    extras.set(e.month, x);
  }
  // One-off extra repayments grouped per month, in input order (SPEC D17).
  const loanIndex = new Map(loans.map((l, i) => [l.id, i]));
  const extraRepayments = new Map<YearMonth, { index: number; amount: Cents; fromSavings: boolean }[]>();
  for (const r of input.extraRepayments ?? []) {
    const index = loanIndex.get(r.loanId);
    if (index === undefined || r.amount <= 0) continue;
    const list = extraRepayments.get(r.month) ?? [];
    list.push({ index, amount: r.amount, fromSavings: r.source === "freeSavings" });
    extraRepayments.set(r.month, list);
  }

  let balances = loans.map((l) => Math.max(0, l.principal));
  let baselineBalances = [...balances];
  let movingPrev = budget.movingAlreadySaved;
  let emergencyPrev = budget.emergencyExisting;
  let freePrev = budget.freeSavingsExisting ?? 0;

  const months: PlanMonth[] = [];
  for (let index = 1; index <= HORIZON_MONTHS; index++) {
    const month = addMonths(budget.startMonth, index - 1);
    const extra = extras.get(month);
    const extraIncome = extra?.income ?? 0;
    const extraExpenses = extra?.expenses ?? 0;
    const regular = regularBudget(month);
    const income = regular.income + extraIncome;
    const expenses = regular.expenses + extraExpenses;

    // Calcul, plan scenario: interest, normal payment (last one capped; residual < 1 € absorbed).
    const loanMonths: LoanMonth[] = loans.map((loan, i) => {
      const startBalance = balances[i] as Cents;
      const interest = monthlyInterest(startBalance, loan.apr);
      const paymentPaid = normalPayment(startBalance + interest, loan.monthlyPayment);
      const baselineStart = baselineBalances[i] as Cents;
      const baselineInterest = monthlyInterest(baselineStart, loan.apr);
      const baselinePayment = normalPayment(baselineStart + baselineInterest, loan.monthlyPayment);
      return {
        startBalance,
        interest,
        paymentPaid,
        balanceAfterPayment: startBalance + interest - paymentPaid,
        extraRepayment: 0,
        earlyRepayment: 0,
        penalty: 0,
        endBalance: 0,
        baselineInterest,
        baselineEndBalance: baselineStart + baselineInterest - baselinePayment,
      };
    });
    const loanPayments = sumCents(loanMonths.map((l) => l.paymentPaid));

    // Plan ① available, ② moving fund, ③ emergency fund, ④ remainder.
    const available = income - expenses - loanPayments;
    const toMoving =
      compareMonths(month, budget.movingDeadlineMonth) <= 0
        ? Math.max(0, Math.min(available, budget.movingGoal - movingPrev))
        : 0;
    const movingCumulative = movingPrev + toMoving;
    const toEmergency = Math.max(0, Math.min(available - toMoving, budget.emergencyTarget - emergencyPrev));
    const emergencyCumulative = emergencyPrev + toEmergency;
    const remainder = Math.max(0, available - toMoving - toEmergency);
    const toEarlyRepayment = roundHalfAwayFromZero(remainder * budget.earlyRepaymentPct);

    // One-off extra repayments (SPEC D17): after the normal payment, capped at the balance left.
    let extraFromFreeSavings = 0;
    for (const r of extraRepayments.get(month) ?? []) {
      const lm = loanMonths[r.index] as LoanMonth;
      const applied = Math.min(r.amount, lm.balanceAfterPayment - lm.extraRepayment);
      if (applied <= 0) continue;
      lm.extraRepayment += applied;
      if (r.fromSavings) extraFromFreeSavings += applied;
    }

    // Avalanche: the budget fills each loan up to its open balance, in priority order. A loan with a
    // penalty (D22) pays it from the same budget, and is skipped when repaying it is not worth it.
    let budgetLeft = toEarlyRepayment;
    for (const i of avalancheOrder) {
      if (budgetLeft <= 0) break;
      const loan = loans[i] as LoanInput;
      const lm = loanMonths[i] as LoanMonth;
      const open = lm.balanceAfterPayment - lm.extraRepayment;
      if (open <= 0) continue;
      const rate = penaltyRate(loan);
      if (rate === 0) {
        lm.earlyRepayment = Math.min(open, budgetLeft);
      } else {
        if (!worthRepaying(loan, open)) continue;
        let repaid = Math.min(open, Math.floor(budgetLeft / (1 + rate)));
        // Largest repayment whose penalty still fits the budget (the division can be off by a cent).
        while (repaid > 0 && repaid + penaltyFor(loan, repaid) > budgetLeft) repaid -= 1;
        while (repaid < open && repaid + 1 + penaltyFor(loan, repaid + 1) <= budgetLeft) repaid += 1;
        lm.earlyRepayment = Math.max(0, repaid);
        lm.penalty = penaltyFor(loan, lm.earlyRepayment);
      }
      budgetLeft -= lm.earlyRepayment + lm.penalty;
    }
    for (const lm of loanMonths) lm.endBalance = lm.balanceAfterPayment - lm.extraRepayment - lm.earlyRepayment;

    const totalEarlyRepayment = sumCents(loanMonths.map((l) => l.earlyRepayment));
    const totalPenalty = sumCents(loanMonths.map((l) => l.penalty));
    const unusedEarlyRepayment = Math.max(0, toEarlyRepayment - totalEarlyRepayment - totalPenalty);
    const toFreeSavings = remainder - toEarlyRepayment + unusedEarlyRepayment;
    const freeSavingsCumulative = freePrev + toFreeSavings - extraFromFreeSavings;
    const remainingDebt = sumCents(loanMonths.map((l) => l.endBalance));

    months.push({
      index,
      month,
      income,
      expenses,
      extraIncome,
      extraExpenses,
      loanPayments,
      available,
      toMoving,
      movingCumulative,
      toEmergency,
      emergencyCumulative,
      remainder,
      toEarlyRepayment,
      unusedEarlyRepayment,
      toFreeSavings,
      freeSavingsCumulative,
      remainingDebt,
      negativeBudget: available < 0,
      movingReached: movingCumulative >= budget.movingGoal,
      emergencyReached: emergencyCumulative >= budget.emergencyTarget,
      debtFree: remainingDebt <= PAID_OFF_THRESHOLD,
      loans: loanMonths,
      totalEarlyRepayment,
      totalPenalty,
      totalExtraRepayment: sumCents(loanMonths.map((l) => l.extraRepayment)),
      extraFromFreeSavings,
      totalInterest: sumCents(loanMonths.map((l) => l.interest)),
      totalBaselineInterest: sumCents(loanMonths.map((l) => l.baselineInterest)),
    });

    balances = loanMonths.map((l) => l.endBalance);
    baselineBalances = loanMonths.map((l) => l.baselineEndBalance);
    movingPrev = movingCumulative;
    emergencyPrev = emergencyCumulative;
    freePrev = freeSavingsCumulative;
  }

  return {
    months,
    loans: summarizeLoans(loans, priorities, months),
    kpis: computeKpis(input, months),
  };
}

function firstMonth(months: readonly PlanMonth[], predicate: (m: PlanMonth) => boolean): YearMonth | null {
  return months.find(predicate)?.month ?? null;
}

function summarizeLoans(
  loans: readonly LoanInput[],
  priorities: readonly (number | null)[],
  months: readonly PlanMonth[],
): LoanSummary[] {
  return loans.map((loan, i) => {
    const priority = priorities[i] ?? null;
    const at = (m: PlanMonth) => m.loans[i] as LoanMonth;
    const repaid = loan.principal > 0;
    return {
      id: loan.id,
      displayName: loan.name?.trim() ? loan.name.trim() : `Crédit ${i + 1}`,
      eligible: priority !== null,
      priority,
      advice: adviceFor(loan, priority !== null),
      payoffMonthWithPlan: repaid ? firstMonth(months, (m) => at(m).endBalance <= PAID_OFF_THRESHOLD) : null,
      payoffMonthWithoutPlan: repaid ? firstMonth(months, (m) => at(m).baselineEndBalance <= PAID_OFF_THRESHOLD) : null,
      interestWithPlan: sumCents(months.map((m) => at(m).interest)),
      interestWithoutPlan: sumCents(months.map((m) => at(m).baselineInterest)),
      penaltiesPaid: sumCents(months.map((m) => at(m).penalty)),
      paymentBelowInterest: loan.principal > 0 && loan.monthlyPayment <= monthlyInterest(loan.principal, loan.apr),
    };
  });
}

function computeKpis(input: PlanInput, months: readonly PlanMonth[]): PlanKpis {
  const { budget, loans } = input;
  const monthlyIncome = budget.income;
  const monthlyExpenses = budget.fixedCosts + budget.variableExpenses;
  const monthlyLoanPayments = sumCents(loans.map((l) => l.monthlyPayment));
  const debtRatio = monthlyIncome > 0 ? monthlyLoanPayments / monthlyIncome : 0;
  const totalPrincipal = sumCents(loans.map((l) => l.principal));
  const weightedApr =
    totalPrincipal > 0 ? loans.reduce((acc, l) => acc + l.principal * l.apr, 0) / totalPrincipal : 0;

  const deadlineOffset = monthsBetween(budget.startMonth, budget.movingDeadlineMonth);
  const deadlineBeforeStart = deadlineOffset < 0;
  const movingMonthlyNeeded = deadlineBeforeStart
    ? 0
    : roundHalfAwayFromZero(
        Math.max(0, budget.movingGoal - budget.movingAlreadySaved) / Math.max(1, deadlineOffset + 1),
      );
  const lastBeforeDeadline = months.filter((m) => compareMonths(m.month, budget.movingDeadlineMonth) <= 0).at(-1);
  const movingAmountAtDeadline = lastBeforeDeadline?.movingCumulative ?? budget.movingAlreadySaved;

  const interestWithoutPlan = sumCents(months.map((m) => m.totalBaselineInterest));
  const interestWithPlan = sumCents(months.map((m) => m.totalInterest));
  const penaltiesPaid = sumCents(months.map((m) => m.totalPenalty));
  const month12 = months[11] as PlanMonth;
  const hasDebt = totalPrincipal > 0;

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyLoanPayments,
    margin: monthlyIncome - monthlyExpenses - monthlyLoanPayments,
    debtRatio,
    debtAlert: debtAlertFor(debtRatio),
    totalPrincipal,
    weightedApr,
    movingGoal: budget.movingGoal,
    movingMonthlyNeeded,
    deadlineBeforeStart,
    movingAmountAtDeadline,
    movingGoalMet: movingAmountAtDeadline >= budget.movingGoal,
    movingReachedMonth: firstMonth(months, (m) => m.movingReached),
    emergencyTarget: budget.emergencyTarget,
    emergencyReachedMonth: firstMonth(months, (m) => m.emergencyReached),
    hasDebt,
    debtFreeMonth: hasDebt ? firstMonth(months, (m) => m.debtFree) : null,
    interestWithoutPlan,
    interestWithPlan,
    interestSaved: interestWithoutPlan - interestWithPlan - penaltiesPaid,
    penaltiesPaid,
    freeSavingsAt12: month12.freeSavingsCumulative,
    emergencyFundAt12: month12.emergencyCumulative,
    remainingDebtAt12: month12.remainingDebt,
    negativeBudgetMonths: months.filter((m) => m.negativeBudget).length,
  };
}
