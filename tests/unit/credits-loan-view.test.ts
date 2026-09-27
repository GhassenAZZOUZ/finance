/** /credits view-model: rows (with and without a plan), totals (SPEC §5) and form reading. */
import { describe, expect, it } from "vitest";
import {
  buildLoanRows,
  computeLoanTotals,
  isPaymentBelowInterest,
  loanDisplayName,
  loanToForm,
  readLoanForm,
  checkContractEnd,
  readLoanId,
} from "@/app/(app)/credits/loan-view";
import { computePlan } from "@/lib/domain/plan";
import type { FinanceSnapshot, Loan } from "@/lib/domain/types";
import { validateLoan } from "@/lib/domain/validation";

function loan(id: string, over: Partial<Loan> = {}): Loan {
  return {
    id,
    name: null,
    type: null,
    principal: 1_000_000,
    apr: 0.05,
    monthlyPayment: 20_000,
    principalPaidThroughMonth: null,
    contractEndMonth: null,
    position: 0,
    archivedAt: null,
    ...over,
  };
}

const loans: Loan[] = [
  loan("a", { name: "Auto", type: "Prêt affecté", principal: 800_000, apr: 0.049, monthlyPayment: 25_000 }),
  loan("b", { principal: 200_000, apr: 0.189, monthlyPayment: 10_000, position: 1 }),
  loan("c", { name: "  ", principal: 50_000, apr: 0, monthlyPayment: 5_000, position: 2 }),
];

function snapshot(withSettings: boolean): FinanceSnapshot {
  return {
    settings: withSettings
      ? {
          startMonth: "2026-01",
          movingGoal: 500_000,
          movingDeadlineMonth: "2027-06",
          movingAlreadySaved: 0,
          emergencyTarget: 300_000,
          emergencyExisting: 0,
          riskFreeRate: 0.03,
          earlyRepaymentPct: 0.5,
        }
      : null,
    lines: [
      { id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0 },
      { id: "f", category: "fixed", label: "Loyer", amount: 90_000, position: 0 },
    ],
    loans,
    archivedLoans: [],
    actuals: [],
  };
}

describe("loanDisplayName", () => {
  it("falls back to 'Crédit n' for empty names", () => {
    expect(loanDisplayName({ name: "Auto" }, 0)).toBe("Auto");
    expect(loanDisplayName({ name: null }, 1)).toBe("Crédit 2");
    expect(loanDisplayName({ name: "   " }, 2)).toBe("Crédit 3");
  });
});

describe("buildLoanRows", () => {
  it("without a plan: loans in entry order, no derived values", () => {
    const rows = buildLoanRows(loans, null);
    expect(rows.map((r) => r.displayName)).toEqual(["Auto", "Crédit 2", "Crédit 3"]);
    expect(rows.every((r) => r.derived === null)).toBe(true);
    expect(rows[0]).toMatchObject({ type: "Prêt affecté", principal: 800_000, apr: 0.049, monthlyPayment: 25_000 });
  });

  it("with a plan: derived values come from the engine, in the same order", () => {
    const plan = computePlan(snapshot(true));
    const rows = buildLoanRows(loans, plan);
    expect(rows.map((r) => r.displayName)).toEqual(["Auto", "Crédit 2", "Crédit 3"]);
    // Avalanche: 18.9 % first, 4.9 % second, 0 % never eligible.
    expect(rows.map((r) => r.derived?.priority)).toEqual([2, 1, null]);
    expect(rows.map((r) => r.derived?.eligible)).toEqual([true, true, false]);
    expect(rows.map((r) => r.derived?.advice)).toEqual(["worthIt", "highRate", "keep"]);
    for (const r of rows) {
      expect(r.derived!.interestWithPlan).toBeLessThanOrEqual(r.derived!.interestWithoutPlan);
    }
  });
});

describe("isPaymentBelowInterest (SPEC D10)", () => {
  it("flags a payment that does not exceed the first month's interest", () => {
    // 10 000 € at 12 % → 100 € interest per month.
    expect(isPaymentBelowInterest({ principal: 1_000_000, apr: 0.12, monthlyPayment: 10_000 })).toBe(true);
    expect(isPaymentBelowInterest({ principal: 1_000_000, apr: 0.12, monthlyPayment: 10_001 })).toBe(false);
  });

  it("matches the engine's flag when a plan exists", () => {
    const low = [loan("x", { principal: 1_000_000, apr: 0.12, monthlyPayment: 9_000 })];
    const plan = computePlan({ ...snapshot(true), loans: low });
    expect(buildLoanRows(low, plan)[0]?.paymentBelowInterest).toBe(true);
    expect(buildLoanRows(low, null)[0]?.paymentBelowInterest).toBe(true);
  });
});

describe("computeLoanTotals", () => {
  it("computes SPEC §5 totals without a plan", () => {
    const totals = computeLoanTotals(loans, null);
    expect(totals.totalPrincipal).toBe(1_050_000);
    expect(totals.monthlyPayments).toBe(40_000);
    expect(totals.weightedApr).toBeCloseTo((800_000 * 0.049 + 200_000 * 0.189) / 1_050_000, 12);
  });

  it("returns 0 % weighted APR when there are no loans", () => {
    expect(computeLoanTotals([], null)).toEqual({ totalPrincipal: 0, weightedApr: 0, monthlyPayments: 0 });
  });

  it("agrees with the engine KPIs when a plan exists", () => {
    const plan = computePlan(snapshot(true));
    const withPlan = computeLoanTotals(loans, plan);
    const withoutPlan = computeLoanTotals(loans, null);
    expect(withPlan.totalPrincipal).toBe(withoutPlan.totalPrincipal);
    expect(withPlan.monthlyPayments).toBe(withoutPlan.monthlyPayments);
    expect(withPlan.weightedApr).toBeCloseTo(withoutPlan.weightedApr, 12);
  });
});

describe("form helpers", () => {
  it("loanToForm round-trips through validateLoan", () => {
    const form = loanToForm(loans[0]!);
    expect(form).toEqual({
      name: "Auto",
      type: "Prêt affecté",
      principal: "8000,00",
      apr: "4,9",
      monthlyPayment: "250,00",
      contractEndMonth: "",
      principalPaidThroughMonth: "",
    });
    const validated = validateLoan(form, 0);
    expect(validated).toEqual({
      ok: true,
      value: {
        name: "Auto",
        type: "Prêt affecté",
        principal: 800_000,
        principalPaidThroughMonth: null,
        apr: 0.049,
        monthlyPayment: 25_000,
        contractEndMonth: null,
      },
    });
  });

  it("readLoanForm / readLoanId tolerate missing and non-text fields", () => {
    const fd = new FormData();
    fd.set("name", "Auto");
    fd.set("principal", "1 000");
    fd.set("apr", new Blob(["x"]));
    expect(readLoanForm(fd)).toEqual({
      name: "Auto",
      type: "",
      principal: "1 000",
      apr: "",
      monthlyPayment: "",
      contractEndMonth: "",
      principalPaidThroughMonth: "",
    });
    expect(readLoanId(fd)).toBe("");
    fd.set("id", " abc ");
    expect(readLoanId(fd)).toBe("abc");
  });
});

describe("checkContractEnd (SPEC D5b)", () => {
  it("is consistent within ±1 month of the simulated end", () => {
    expect(checkContractEnd("2028-06", "2028-07")).toEqual({
      contractEndMonth: "2028-06",
      simulatedEndMonth: "2028-07",
      gapMonths: 1,
      consistent: true,
    });
    expect(checkContractEnd("2028-06", "2028-05")?.consistent).toBe(true);
  });

  it("flags a gap larger than one month, in both directions", () => {
    expect(checkContractEnd("2028-06", "2028-10")).toMatchObject({ gapMonths: 4, consistent: false });
    expect(checkContractEnd("2028-06", "2027-12")).toMatchObject({ gapMonths: -6, consistent: false });
  });

  it("flags a loan that never ends within the horizon", () => {
    expect(checkContractEnd("2028-06", null)).toMatchObject({ gapMonths: null, consistent: false });
  });

  it("does nothing without a contract end or without a plan", () => {
    expect(checkContractEnd(null, "2028-06")).toBeNull();
    expect(checkContractEnd("2028-06", undefined)).toBeNull();
  });

  it("uses the simulated end without early repayment, through buildLoanRows", () => {
    const snapshot: FinanceSnapshot = {
      settings: {
        startMonth: "2027-01",
        movingGoal: 0,
        movingDeadlineMonth: "2027-01",
        movingAlreadySaved: 0,
        emergencyTarget: 0,
        emergencyExisting: 0,
        riskFreeRate: 0.02,
        earlyRepaymentPct: 1,
      },
      lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0 }],
      // 1 200,00 € at 0 %, 100,00 €/month: 12 payments, last one in December 2027.
      loans: [loan("a", { principal: 120_000, apr: 0, monthlyPayment: 10_000, contractEndMonth: "2028-06" })],
      archivedLoans: [],
      actuals: [],
    };
    const [row] = buildLoanRows(snapshot.loans, computePlan(snapshot));
    expect(row?.endCheck).toMatchObject({ simulatedEndMonth: "2027-12", gapMonths: -6, consistent: false });
  });
});

describe("principal read before the plan start (SPEC D5c)", () => {
  const settings = {
    startMonth: "2026-11",
    movingGoal: 0,
    movingDeadlineMonth: "2026-11",
    movingAlreadySaved: 0,
    emergencyTarget: 0,
    emergencyExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 0,
  };
  const snap = (paid: string | null): FinanceSnapshot => ({
    settings,
    lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0 }],
    // 1 000,00 € at 12 %, 100,00 €/month.
    loans: [loan("a", { principal: 100_000, apr: 0.12, monthlyPayment: 10_000, principalPaidThroughMonth: paid })],
    archivedLoans: [],
    actuals: [],
  });

  it("read after the September payment, plan in November: October's payment is deducted", () => {
    const plan = computePlan(snap("2026-09"));
    expect(plan?.input.loans[0]?.principal).toBe(91_000);
    const [row] = buildLoanRows(snap("2026-09").loans, plan);
    expect(row).toMatchObject({ principal: 100_000, principalAtStart: { month: "2026-11", amount: 91_000 }, principalReadAfterStart: null });
  });

  it("read after the October payment: nothing to deduct, no note", () => {
    const plan = computePlan(snap("2026-10"));
    expect(plan?.input.loans[0]?.principal).toBe(100_000);
    expect(buildLoanRows(snap("2026-10").loans, plan)[0]?.principalAtStart).toBeNull();
  });

  it("read after the plan start: used as is, with a warning", () => {
    const plan = computePlan(snap("2026-12"));
    expect(plan?.input.loans[0]?.principal).toBe(100_000);
    expect(buildLoanRows(snap("2026-12").loans, plan)[0]).toMatchObject({ principalAtStart: null, principalReadAfterStart: "2026-11" });
  });

  it("no month given: the principal is the one at the plan start (previous behaviour)", () => {
    expect(computePlan(snap(null))?.input.loans[0]?.principal).toBe(100_000);
  });
});

describe("loan repaid before the plan start", () => {
  it("shows the month it was repaid instead of 'Au-delà de 25 ans'", () => {
    // 100,00 € at 0 %, 100,00 €/month, read after the September payment, plan in November:
    // October's payment repays it.
    const snapshot: FinanceSnapshot = {
      settings: {
        startMonth: "2026-11",
        movingGoal: 0,
        movingDeadlineMonth: "2026-11",
        movingAlreadySaved: 0,
        emergencyTarget: 0,
        emergencyExisting: 0,
        riskFreeRate: 0.02,
        earlyRepaymentPct: 0,
      },
      lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0 }],
      loans: [
        loan("a", { principal: 10_000, apr: 0, monthlyPayment: 10_000, principalPaidThroughMonth: "2026-09", contractEndMonth: "2026-10" }),
      ],
      archivedLoans: [],
      actuals: [],
    };
    const [row] = buildLoanRows(snapshot.loans, computePlan(snapshot));
    expect(row).toMatchObject({
      paidOffBeforeStart: "2026-10",
      principalAtStart: null,
      endCheck: { simulatedEndMonth: "2026-10", consistent: true },
    });
  });
});
