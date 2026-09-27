/**
 * The engine must reproduce the spreadsheet (Excel recalculation, xx.xx-patched) for every
 * scenario in tests/fixtures/golden.json. Money: exact cents. Ratios: 1e-8.
 */
import { describe, expect, it } from "vitest";
import {
  type Cents,
  type LoanMonth,
  type PlanMonth,
  compareActual,
  eurosToCents,
  latestActual,
  simulatePlan,
} from "@/lib/engine";
import {
  ADVICE_LABEL,
  DEBT_ALERT_LABEL,
  STATUS_LABEL,
  activeSlots,
  debtFreeLabel,
  emergencyReachedLabel,
  loadGolden,
  movingReachedLabel,
  movingStatusLabel,
  toActualInputs,
  toPlanInput,
} from "./golden";

const golden = loadGolden();

/** Collects mismatches instead of failing on the first one, for readable diffs. */
class Diff {
  readonly issues: string[] = [];
  money(where: string, actual: Cents | null, expectedEuros: number | string | boolean | null | undefined) {
    const expected = typeof expectedEuros === "number" ? eurosToCents(expectedEuros) : null;
    if (actual !== expected) this.issues.push(`${where}: engine ${actual} cents, Excel ${expected} cents`);
  }
  ratio(where: string, actual: number, expected: unknown) {
    if (typeof expected !== "number" || Math.abs(actual - expected) > 1e-8) {
      this.issues.push(`${where}: engine ${actual}, Excel ${String(expected)}`);
    }
  }
  same(where: string, actual: unknown, expected: unknown) {
    if (actual !== expected) this.issues.push(`${where}: engine ${String(actual)}, Excel ${String(expected)}`);
  }
}

const PLAN_MONEY = [
  "income",
  "expenses",
  "loanPayments",
  "available",
  "toMoving",
  "movingCumulative",
  "toEmergency",
  "emergencyCumulative",
  "remainder",
  "toEarlyRepayment",
  "unusedEarlyRepayment",
  "toFreeSavings",
  "freeSavingsCumulative",
  "remainingDebt",
] as const satisfies readonly (keyof PlanMonth)[];
const PLAN_FLAGS = ["negativeBudget", "movingReached", "emergencyReached", "debtFree"] as const;

/** Order of golden.calculLoanColumns. */
const CALCUL_FIELDS = [
  "startBalance",
  "interest",
  "paymentPaid",
  "balanceAfterPayment",
  "earlyRepayment",
  "endBalance",
  "baselineEndBalance",
  "baselineInterest",
] as const satisfies readonly (keyof LoanMonth)[];

it("golden column layout matches the engine", () => {
  expect(golden.calculLoanColumns).toEqual([...CALCUL_FIELDS]);
  expect(golden.scenarios.length).toBeGreaterThanOrEqual(15);
});

describe.each(golden.scenarios.map((s) => [s.id, s] as const))("golden scenario %s", (_id, scenario) => {
  const input = toPlanInput(scenario);
  const result = simulatePlan(input);
  const slots = activeSlots(scenario);
  const exp = scenario.expected;

  it("reproduces the Plan sheet month by month", () => {
    const d = new Diff();
    expect(result.months).toHaveLength(golden.horizonMonths);
    result.months.forEach((m, i) => {
      const row = exp.plan[i] as Record<string, number | string | boolean>;
      d.same(`m${m.index}.month`, m.index, row.month);
      d.same(`m${m.index}.yearMonth`, m.month, row.yearMonth);
      for (const key of PLAN_MONEY) d.money(`m${m.index}.${key}`, m[key], row[key]);
      for (const key of PLAN_FLAGS) d.same(`m${m.index}.${key}`, m[key], row[key]);
    });
    expect(d.issues.slice(0, 20)).toEqual([]);
  });

  it("reproduces the Calcul sheet for every loan (plan + baseline)", () => {
    const d = new Diff();
    result.months.forEach((m, i) => {
      const row = exp.calcul[i]!;
      d.money(`m${m.index}.totalPayments`, m.loanPayments, row.totalPayments);
      d.money(`m${m.index}.totalEarlyRepayment`, m.totalEarlyRepayment, row.totalEarlyRepayment);
      d.money(`m${m.index}.totalEndDebt`, m.remainingDebt, row.totalEndDebt);
      d.money(`m${m.index}.totalInterest`, m.totalInterest, row.totalInterest);
      d.money(`m${m.index}.totalBaselineInterest`, m.totalBaselineInterest, row.totalBaselineInterest);
      row.loans.forEach((values, slotIdx) => {
        const engineIdx = slots.findIndex((s) => s.slot === slotIdx + 1);
        CALCUL_FIELDS.forEach((field, f) => {
          const actual = engineIdx === -1 ? 0 : (m.loans[engineIdx] as LoanMonth)[field];
          d.money(`m${m.index}.slot${slotIdx + 1}.${field}`, actual, values[f]);
        });
      });
    });
    expect(d.issues.slice(0, 20)).toEqual([]);
  });

  it("reproduces the Crédits derived columns and totals", () => {
    const d = new Diff();
    exp.credits.forEach((c) => {
      const engineIdx = slots.findIndex((s) => s.slot === c.slot);
      if (engineIdx === -1) {
        d.same(`slot${c.slot}.worthIt (empty slot)`, null, c.earlyRepaymentWorthIt);
        return;
      }
      const loan = result.loans[engineIdx]!;
      d.same(`slot${c.slot}.worthIt`, loan.eligible ? "Oui" : "Non", c.earlyRepaymentWorthIt);
      d.same(`slot${c.slot}.priority`, loan.priority, c.priority);
      d.same(`slot${c.slot}.advice`, ADVICE_LABEL[loan.advice], c.advice);
      d.same(`slot${c.slot}.payoffWithPlan`, loan.payoffMonthWithPlan, c.payoffMonthWithPlan);
      d.same(`slot${c.slot}.payoffWithoutPlan`, loan.payoffMonthWithoutPlan, c.payoffMonthWithoutPlan);
      d.money(`slot${c.slot}.interestWithPlan`, loan.interestWithPlan, c.interestWithPlan);
      d.money(`slot${c.slot}.interestWithoutPlan`, loan.interestWithoutPlan, c.interestWithoutPlan);
    });
    d.money("totals.principal", result.kpis.totalPrincipal, exp.creditsTotals.principal);
    d.ratio("totals.weightedApr", result.kpis.weightedApr, exp.creditsTotals.weightedApr);
    d.money("totals.monthlyPayments", result.kpis.monthlyLoanPayments, exp.creditsTotals.monthlyPayments);
    expect(d.issues).toEqual([]);
  });

  it("reproduces the Synthèse KPIs", () => {
    const d = new Diff();
    const k = result.kpis;
    const s = exp.synthese;
    d.money("monthlyIncome", k.monthlyIncome, s.monthlyIncome);
    d.money("monthlyExpenses", k.monthlyExpenses, s.monthlyExpenses);
    d.money("monthlyLoanPayments", k.monthlyLoanPayments, s.monthlyLoanPayments);
    d.money("margin", k.margin, s.margin);
    d.ratio("debtRatio", k.debtRatio, s.debtRatio);
    d.same("debtAlert", DEBT_ALERT_LABEL[k.debtAlert], s.debtAlert);
    d.money("totalPrincipal", k.totalPrincipal, s.totalPrincipal);
    d.ratio("weightedApr", k.weightedApr, s.weightedApr);
    d.money("movingGoal", k.movingGoal, s.movingGoal);
    d.money("movingMonthlyNeeded", k.movingMonthlyNeeded, s.movingMonthlyNeeded);
    d.money("movingAmountAtDeadline", k.movingAmountAtDeadline, s.movingAmountAtDeadline);
    d.same("movingReachedDate", movingReachedLabel(k), s.movingReachedDate);
    d.same("movingStatus", movingStatusLabel(k), s.movingStatus);
    d.money("emergencyTarget", k.emergencyTarget, s.emergencyTarget);
    d.same("emergencyReachedDate", emergencyReachedLabel(k), s.emergencyReachedDate);
    d.same("debtFreeDate", debtFreeLabel(k), s.debtFreeDate);
    d.money("interestWithoutPlan", k.interestWithoutPlan, s.interestWithoutPlan);
    d.money("interestWithPlan", k.interestWithPlan, s.interestWithPlan);
    d.money("interestSaved", k.interestSaved, s.interestSaved);
    d.money("freeSavingsAt12", k.freeSavingsAt12, s.freeSavingsAt12);
    d.money("emergencyFundAt12", k.emergencyFundAt12, s.emergencyFundAt12);
    d.money("remainingDebtAt12", k.remainingDebtAt12, s.remainingDebtAt12);
    d.same("negativeBudgetMonths", k.negativeBudgetMonths, s.negativeBudgetMonths);
    expect(d.issues).toEqual([]);
  });

  it("reproduces Suivi réel comparisons and the latest status", () => {
    const d = new Diff();
    const comparisons = toActualInputs(scenario).map((a) => compareActual(a, result, input.budget));
    expect(comparisons).toHaveLength(exp.suivi.length);
    comparisons.forEach((c, i) => {
      const row = exp.suivi[i]!;
      d.same(`${c.month}.month`, c.month, row.month);
      d.money(`${c.month}.actualDebt`, c.actualDebt, row.actualDebt);
      d.money(`${c.month}.plannedDebt`, c.plannedDebt, row.plannedDebt);
      d.money(`${c.month}.debtGap`, c.debtGap, row.debtGap);
      d.money(`${c.month}.actualSavings`, c.actualSavings, row.actualSavings);
      d.money(`${c.month}.plannedSavings`, c.plannedSavings, row.plannedSavings);
      d.money(`${c.month}.savingsGap`, c.savingsGap, row.savingsGap);
      d.ratio(`${c.month}.movingGoalPct`, c.movingGoalPct, row.movingGoalPct);
      d.ratio(`${c.month}.debtRepaidPct`, c.debtRepaidPct, row.debtRepaidPct);
      d.same(`${c.month}.status`, c.status && STATUS_LABEL[c.status], row.status);
    });
    const latest = latestActual(comparisons);
    const s = exp.synthese;
    d.same("latestActualMonth", latest ? latest.month : "Aucune saisie", s.latestActualMonth);
    d.money("latestDebtGap", latest ? latest.debtGap : 0, s.latestDebtGap);
    d.money("latestSavingsGap", latest ? latest.savingsGap : 0, s.latestSavingsGap);
    d.same("latestStatus", latest?.status ? STATUS_LABEL[latest.status] : "—", s.latestStatus);
    expect(d.issues).toEqual([]);
  });
});
