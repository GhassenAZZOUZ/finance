/**
 * Early-repayment penalties (IRA, issue #9, SPEC D22), with hand-checkable numbers.
 * Budget: fixed + variable = 1 500,00 €; earlyRepaymentPct = 100 %, so the early-repayment budget
 * is `income − 1 500 € − loan payments`.
 */
import { describe, expect, it } from "vitest";
import { validateLoan } from "@/lib/domain/validation";
import { type BudgetParams, type LoanInput, type PlanMonth, penaltyFor, simulatePlan } from "@/lib/engine";

function budget(income: number): BudgetParams {
  return {
    income,
    fixedCosts: 100_000,
    variableExpenses: 50_000,
    startMonth: "2027-01",
    movingGoal: 0,
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: 0,
    emergencyTarget: 0,
    emergencyExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 1,
  };
}

const loan = (id: string, principal: number, apr: number, monthlyPayment: number, extra: Partial<LoanInput> = {}): LoanInput => ({
  id,
  name: id,
  principal,
  apr,
  monthlyPayment,
  ...extra,
});
const m1 = (months: PlanMonth[]) => months[0] as PlanMonth;

describe("penaltyFor", () => {
  it("is pct × repaid, rounded to the cent", () => {
    expect(penaltyFor(loan("a", 1, 0.12, 1, { penaltyPct: 0.03 }), 100_000)).toBe(3_000);
    expect(penaltyFor(loan("a", 1, 0.12, 1, { penaltyPct: 0.03 }), 29_150)).toBe(875); // 874.5 → 875
  });
  it("is capped at N months of interest on the repaid capital", () => {
    // 3 % of 10 000 € = 300 €; 6 months at 3 % = 10 000 × 0.03 / 12 × 6 = 150 €.
    expect(penaltyFor(loan("a", 1, 0.03, 1, { penaltyPct: 0.03, penaltyCapMonths: 6 }), 1_000_000)).toBe(15_000);
  });
  it("is 0 without a penalty", () => {
    expect(penaltyFor(loan("a", 1, 0.12, 1), 100_000)).toBe(0);
    expect(penaltyFor(loan("a", 1, 0.12, 1, { penaltyPct: 0 }), 100_000)).toBe(0);
  });
});

describe("avalanche with penalties", () => {
  it("records the penalty on each early repayment, paid from the budget (AC-03)", () => {
    // Budget 1 030,00 € → 1 000,00 € of capital + 30,00 € of IRA (3 %).
    const { months } = simulatePlan({
      budget: budget(150_000 + 20_000 + 103_000),
      loans: [loan("a", 1_000_000, 0.12, 20_000, { penaltyPct: 0.03 })],
    });
    expect(m1(months).toEarlyRepayment).toBe(103_000);
    expect(m1(months).loans[0]).toMatchObject({ earlyRepayment: 100_000, penalty: 3_000 });
    expect(m1(months).totalPenalty).toBe(3_000);
    expect(m1(months).unusedEarlyRepayment).toBe(0);
  });

  it("applies the cap (AC-07)", () => {
    // 50 000 € at 3 %, budget 10 150,00 € → 10 000,00 € repaid, IRA min(300, 150) = 150,00 €.
    const { months } = simulatePlan({
      budget: budget(150_000 + 50_000 + 1_015_000),
      loans: [loan("a", 5_000_000, 0.03, 50_000, { penaltyPct: 0.03, penaltyCapMonths: 6 })],
    });
    expect(m1(months).loans[0]).toMatchObject({ earlyRepayment: 1_000_000, penalty: 15_000 });
  });

  it("skips a loan whose penalty exceeds the interest saved; the next loan gets the money (AC-04)", () => {
    // A: 300 € at 20 %, 100 €/month → 205 € open after month 1, 3 more months: a euro repaid saves
    // at most 20 % / 12 × 3 = 5 % < 6 % IRA → skipped. B (10 %, no IRA) receives the 700 €.
    const { months } = simulatePlan({
      budget: budget(150_000 + 30_000 + 70_000),
      loans: [loan("A", 30_000, 0.2, 10_000, { penaltyPct: 0.06 }), loan("B", 1_000_000, 0.1, 20_000)],
    });
    const [a, b] = m1(months).loans;
    expect(a).toMatchObject({ balanceAfterPayment: 20_500, earlyRepayment: 0, penalty: 0 });
    expect(b).toMatchObject({ earlyRepayment: 70_000, penalty: 0 });
  });

  it("sends the budget to free savings when no loan is worth repaying", () => {
    const { months } = simulatePlan({
      budget: budget(150_000 + 10_000 + 70_000),
      loans: [loan("A", 30_000, 0.2, 10_000, { penaltyPct: 0.06 })],
    });
    expect(m1(months)).toMatchObject({ totalEarlyRepayment: 0, totalPenalty: 0, unusedEarlyRepayment: 70_000, toFreeSavings: 70_000 });
  });

  it("shows interest saved net of penalties (AC-05)", () => {
    const { kpis, loans } = simulatePlan({
      budget: budget(150_000 + 20_000 + 103_000),
      loans: [loan("a", 1_000_000, 0.12, 20_000, { penaltyPct: 0.03 })],
    });
    expect(kpis.penaltiesPaid).toBeGreaterThan(0);
    expect(loans[0]?.penaltiesPaid).toBe(kpis.penaltiesPaid);
    expect(kpis.interestSaved).toBe(kpis.interestWithoutPlan - kpis.interestWithPlan - kpis.penaltiesPaid);
  });

  it("a 0 % penalty is the same as no penalty (AC-02)", () => {
    const input = (extra: Partial<LoanInput>) => ({
      budget: budget(300_000),
      loans: [loan("a", 1_000_000, 0.12, 20_000, extra), loan("b", 500_000, 0.08, 15_000)],
    });
    expect(simulatePlan(input({ penaltyPct: 0, penaltyCapMonths: 6 }))).toEqual(simulatePlan(input({})));
  });
});

describe("loan form: IRA fields (AC-06)", () => {
  const form = (penaltyPct: string, penaltyCapMonths: string) => ({
    name: "Immo",
    type: "",
    principal: "100000",
    apr: "3,5",
    monthlyPayment: "800",
    contractEndMonth: "",
    principalPaidThroughMonth: "",
    penaltyPct,
    penaltyCapMonths,
  });

  it("accepts a % with an optional cap in months", () => {
    expect(validateLoan(form("3", "6"), 0)).toMatchObject({ ok: true, value: { penaltyPct: 0.03, penaltyCapMonths: 6 } });
    expect(validateLoan(form("1", ""), 0)).toMatchObject({ ok: true, value: { penaltyPct: 0.01, penaltyCapMonths: null } });
    expect(validateLoan(form("", ""), 0)).toMatchObject({ ok: true, value: { penaltyPct: null, penaltyCapMonths: null } });
  });

  it.each([
    ["-1", "", "penaltyPct", "Le taux ne peut pas être négatif"],
    ["101", "", "penaltyPct", "Le taux doit être inférieur ou égal à 100 %"],
    ["3", "-6", "penaltyCapMonths", "Nombre de mois entier attendu"],
    ["3", "2,5", "penaltyCapMonths", "Nombre de mois entier attendu"],
    ["3", "121", "penaltyCapMonths", "120 mois maximum"],
    ["", "6", "penaltyCapMonths", "Indiquez d’abord le pourcentage d’IRA"],
  ])("rejects IRA %j, cap %j", (pct, cap, field, message) => {
    expect(validateLoan(form(pct, cap), 0)).toEqual({ ok: false, errors: { [field]: message } });
  });
});
