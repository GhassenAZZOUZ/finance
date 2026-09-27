import { type Cents, roundHalfAwayFromZero, sumCents } from "./money";
import { addMonths, compareMonths, monthsBetween, type YearMonth } from "./months";
import {
  HORIZON_MONTHS,
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

  const income = budget.income;
  const expenses = budget.fixedCosts + budget.variableExpenses;

  let balances = loans.map((l) => Math.max(0, l.principal));
  let baselineBalances = [...balances];
  let movingPrev = budget.movingAlreadySaved;
  let emergencyPrev = budget.emergencyExisting;
  let freePrev = 0;

  const months: PlanMonth[] = [];
  for (let index = 1; index <= HORIZON_MONTHS; index++) {
    const month = addMonths(budget.startMonth, index - 1);

    // Calcul, plan scenario: interest, normal payment (capped at balance + interest).
    const loanMonths: LoanMonth[] = loans.map((loan, i) => {
      const startBalance = balances[i] as Cents;
      const interest = monthlyInterest(startBalance, loan.apr);
      const paymentPaid = Math.min(loan.monthlyPayment, startBalance + interest);
      const baselineStart = baselineBalances[i] as Cents;
      const baselineInterest = monthlyInterest(baselineStart, loan.apr);
      const baselinePayment = Math.min(loan.monthlyPayment, baselineStart + baselineInterest);
      return {
        startBalance,
        interest,
        paymentPaid,
        balanceAfterPayment: startBalance + interest - paymentPaid,
        earlyRepayment: 0,
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

    // Avalanche: each loan gets min(its post-payment balance, budget − balances of higher priorities).
    let higherPriorityBalances = 0;
    for (const i of avalancheOrder) {
      const lm = loanMonths[i] as LoanMonth;
      lm.earlyRepayment = Math.max(0, Math.min(lm.balanceAfterPayment, toEarlyRepayment - higherPriorityBalances));
      higherPriorityBalances += lm.balanceAfterPayment;
    }
    for (const lm of loanMonths) lm.endBalance = lm.balanceAfterPayment - lm.earlyRepayment;

    const totalEarlyRepayment = sumCents(loanMonths.map((l) => l.earlyRepayment));
    const unusedEarlyRepayment = Math.max(0, toEarlyRepayment - totalEarlyRepayment);
    const toFreeSavings = remainder - toEarlyRepayment + unusedEarlyRepayment;
    const freeSavingsCumulative = freePrev + toFreeSavings;
    const remainingDebt = sumCents(loanMonths.map((l) => l.endBalance));

    months.push({
      index,
      month,
      income,
      expenses,
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
    interestSaved: interestWithoutPlan - interestWithPlan,
    freeSavingsAt12: month12.freeSavingsCumulative,
    emergencyFundAt12: month12.emergencyCumulative,
    remainingDebtAt12: month12.remainingDebt,
    negativeBudgetMonths: months.filter((m) => m.negativeBudget).length,
  };
}
