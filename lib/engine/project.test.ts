import { describe, expect, it } from "vitest";
import { paymentsBeforeStart, projectBalance } from "./project";
import { simulatePlan } from "./simulate";

describe("paymentsBeforeStart (SPEC D5c)", () => {
  it("counts the payments strictly between the last paid month and the plan start", () => {
    expect(paymentsBeforeStart("2026-09", "2026-11")).toBe(1); // October only
    expect(paymentsBeforeStart("2026-10", "2026-11")).toBe(0);
    expect(paymentsBeforeStart("2026-11", "2026-11")).toBe(-1); // read after the plan start
  });
});

describe("projectBalance", () => {
  it("applies interest then the payment, month by month, in cents", () => {
    // 1 000,00 € at 12 %: +10,00 interest, −100,00 → 910,00; then +9,10 − 100,00 → 819,10.
    expect(projectBalance(100_000, 0.12, 10_000, 1)).toBe(91_000);
    expect(projectBalance(100_000, 0.12, 10_000, 2)).toBe(81_910);
  });

  it("returns the balance unchanged for zero or negative counts", () => {
    expect(projectBalance(100_000, 0.12, 10_000, 0)).toBe(100_000);
    expect(projectBalance(100_000, 0.12, 10_000, -3)).toBe(100_000);
  });

  it("stops at zero (capped last payment) and lets a non-amortizing balance grow", () => {
    expect(projectBalance(15_000, 0, 10_000, 5)).toBe(0);
    expect(projectBalance(100_000, 0.24, 1_000, 1)).toBe(101_000);
  });

  it("matches the simulation: projecting k months equals the plan's end balance after k months", () => {
    const loan = { id: "a", name: null, principal: 820_000, apr: 0.049, monthlyPayment: 24_530 };
    const { months } = simulatePlan({
      budget: {
        income: 0, fixedCosts: 0, variableExpenses: 0, startMonth: "2027-01", movingGoal: 0,
        movingDeadlineMonth: "2027-01", movingAlreadySaved: 0, emergencyTarget: 0, emergencyExisting: 0,
        riskFreeRate: 1, earlyRepaymentPct: 0,
      },
      loans: [loan],
    });
    for (const k of [1, 2, 12, 30]) {
      expect(projectBalance(loan.principal, loan.apr, loan.monthlyPayment, k)).toBe(months[k - 1]!.loans[0]!.endBalance);
    }
  });
});
