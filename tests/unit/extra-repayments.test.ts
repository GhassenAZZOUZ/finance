/** One-off extra repayments (SPEC D17): the "Et si…" simulator's engine extension. */
import { describe, expect, it } from "vitest";
import { type ExtraRepaymentInput, type PlanInput, sumCents, simulatePlan } from "@/lib/engine";

const LOANS: PlanInput["loans"] = [
  { id: "auto", name: "Prêt auto", principal: 500_000, apr: 0.06, monthlyPayment: 20_000 },
  { id: "perso", name: "Prêt perso", principal: 300_000, apr: 0.04, monthlyPayment: 15_000 },
];

function input(earlyRepaymentPct: number, extraRepayments?: ExtraRepaymentInput[]): PlanInput {
  return {
    budget: {
      income: 300_000,
      fixedCosts: 150_000,
      variableExpenses: 50_000,
      startMonth: "2027-01",
      movingGoal: 0,
      movingDeadlineMonth: "2027-01",
      movingAlreadySaved: 0,
      emergencyTarget: 0,
      emergencyExisting: 0,
      freeSavingsExisting: 100_000,
      riskFreeRate: 0.02,
      earlyRepaymentPct,
    },
    loans: LOANS,
    ...(extraRepayments ? { extraRepayments } : {}),
  };
}

const extra = (overrides: Partial<ExtraRepaymentInput> = {}): ExtraRepaymentInput => ({
  month: "2027-03",
  loanId: "auto",
  amount: 200_000,
  source: "external",
  ...overrides,
});

describe("extra repayments (SPEC D17)", () => {
  it("changes nothing when absent or empty", () => {
    const base = simulatePlan(input(0.5));
    expect(simulatePlan(input(0.5, []))).toEqual(base);
    expect(base.months.every((m) => m.totalExtraRepayment === 0 && m.extraFromFreeSavings === 0)).toBe(true);
  });

  it("lowers the loan's end balance of that month by the amount, after the normal payment", () => {
    const current = simulatePlan(input(0)).months[2]!;
    const simulated = simulatePlan(input(0, [extra()])).months[2]!;
    expect(simulated.loans[0]!.balanceAfterPayment).toBe(current.loans[0]!.balanceAfterPayment);
    expect(simulated.loans[0]!.extraRepayment).toBe(200_000);
    expect(simulated.loans[0]!.endBalance).toBe(current.loans[0]!.endBalance - 200_000);
    expect(simulated.loans[1]).toEqual(current.loans[1]);
    expect(simulated.totalExtraRepayment).toBe(200_000);
  });

  it("with outside money, leaves the monthly allocation and savings untouched", () => {
    const current = simulatePlan(input(0)).months;
    const simulated = simulatePlan(input(0, [extra()])).months;
    expect(simulated[2]!.extraFromFreeSavings).toBe(0);
    expect(simulated[2]!.freeSavingsCumulative).toBe(current[2]!.freeSavingsCumulative);
    expect(simulated[1]).toEqual(current[1]);
  });

  it("from the free savings, deducts the amount from the cumulative free savings that month", () => {
    const current = simulatePlan(input(0)).months;
    const simulated = simulatePlan(input(0, [extra({ source: "freeSavings" })])).months;
    expect(simulated[2]!.extraFromFreeSavings).toBe(200_000);
    expect(simulated[2]!.toFreeSavings).toBe(current[2]!.toFreeSavings);
    expect(simulated[2]!.freeSavingsCumulative).toBe(current[2]!.freeSavingsCumulative - 200_000);
  });

  it("saves interest from the next month on and ends the loan earlier; the baseline is unchanged", () => {
    const current = simulatePlan(input(0));
    const simulated = simulatePlan(input(0, [extra()]));
    expect(simulated.months[2]!.loans[0]!.interest).toBe(current.months[2]!.loans[0]!.interest);
    expect(simulated.months[3]!.loans[0]!.interest).toBeLessThan(current.months[3]!.loans[0]!.interest);
    expect(simulated.kpis.interestSaved).toBeGreaterThan(current.kpis.interestSaved);
    expect(simulated.kpis.interestWithoutPlan).toBe(current.kpis.interestWithoutPlan);
    expect(simulated.loans[0]!.payoffMonthWithPlan! < current.loans[0]!.payoffMonthWithPlan!).toBe(true);
  });

  it("is capped at the balance left after the payment: the loan closes that month", () => {
    const current = simulatePlan(input(0)).months[2]!;
    const open = current.loans[0]!.balanceAfterPayment;
    const simulated = simulatePlan(input(0, [extra({ amount: open + 50_000, source: "freeSavings" })])).months;
    expect(simulated[2]!.loans[0]!.extraRepayment).toBe(open);
    expect(simulated[2]!.loans[0]!.endBalance).toBe(0);
    expect(simulated[2]!.extraFromFreeSavings).toBe(open);
    expect(simulated[3]!.loans[0]!.paymentPaid).toBe(0);
  });

  it("applies nothing on a loan already repaid, an unknown loan or a month outside the plan", () => {
    const base = simulatePlan(input(0));
    const payoff = base.loans[0]!.payoffMonthWithPlan!;
    const afterPayoff = base.months.findIndex((m) => m.month === payoff) + 1;
    const late = base.months[afterPayoff]!.month;
    const simulated = simulatePlan(
      input(0, [
        extra({ month: late, source: "freeSavings" }),
        extra({ loanId: "inconnu" }),
        extra({ month: "2026-12" }),
        extra({ month: "2052-01" }),
      ]),
    );
    expect(simulated).toEqual(base);
  });

  it("sums several extras on the same loan and month, capped together", () => {
    const current = simulatePlan(input(0)).months[2]!;
    const open = current.loans[0]!.balanceAfterPayment;
    const simulated = simulatePlan(
      input(0, [
        extra({ amount: open - 10_000, source: "external" }),
        extra({ amount: 30_000, source: "freeSavings" }),
      ]),
    ).months[2]!;
    expect(simulated.loans[0]!.extraRepayment).toBe(open);
    // Only the 100 € still open after the first extra comes out of the savings.
    expect(simulated.extraFromFreeSavings).toBe(10_000);
  });

  it("runs before the avalanche, which spills over to the next priority", () => {
    const current = simulatePlan(input(1)).months[2]!;
    const budget = current.toEarlyRepayment;
    // Leave 200 € open on the priority-1 loan: the rest of the early-repayment budget spills over.
    const amount = current.loans[0]!.balanceAfterPayment - 20_000;
    const simulated = simulatePlan(input(1, [extra({ amount })])).months[2]!;
    expect(budget).toBeGreaterThan(20_000);
    expect(simulated.toEarlyRepayment).toBe(budget);
    expect(simulated.loans[0]!.earlyRepayment).toBe(20_000);
    expect(simulated.loans[0]!.endBalance).toBe(0);
    expect(simulated.loans[1]!.earlyRepayment).toBe(budget - 20_000);
    expect(sumCents(simulated.loans.map((l) => l.earlyRepayment))).toBe(budget);
  });
});
