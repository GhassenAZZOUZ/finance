/**
 * Bank overdraft (issue #28, SPEC D24). The spreadsheet has no overdraft: the engine is compared,
 * to the cent, with the independent Python reference (scripts/reference_overdraft.py) on the
 * scenarios of scripts/overdraft_scenarios.json, plus a few hand-checkable cases.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computePlan } from "@/lib/domain/plan";
import type { FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { validateActual, validateLoan } from "@/lib/domain/validation";
import { type BudgetParams, type LoanInput, type PlanMonth, eurosToCents, simulatePlan } from "@/lib/engine";
import { makeLoan, makeSettings, makeSnapshot } from "../components/helpers";

interface RefLoan {
  id: string;
  kind?: "overdraft";
  limit?: number;
  principal: number;
  apr: number;
  monthlyPayment: number;
}
interface RefScenario {
  id: string;
  budget: {
    income: number;
    expenses: number;
    startMonth: string;
    movingGoal: number;
    movingDeadlineMonth: string;
    movingAlreadySaved: number;
    emergencyTarget: number;
    emergencyExisting: number;
    riskFreeRate: number;
    earlyRepaymentPct: number;
  };
  loans: RefLoan[];
  expected: {
    month: string;
    available: number;
    toEarlyRepayment: number;
    unusedEarlyRepayment: number;
    overdraftDraw: number;
    remainingDebt: number;
    totalInterest: number;
    loans: { interest: number; paymentPaid: number; earlyRepayment: number; draw: number; endBalance: number; baselineEndBalance: number }[];
  }[];
}

const fixture = JSON.parse(readFileSync("tests/fixtures/overdraft-reference.json", "utf8")) as { scenarios: RefScenario[] };

function input(s: RefScenario) {
  const b = s.budget;
  const budget: BudgetParams = {
    income: eurosToCents(b.income),
    fixedCosts: eurosToCents(b.expenses),
    variableExpenses: 0,
    startMonth: b.startMonth,
    movingGoal: eurosToCents(b.movingGoal),
    movingDeadlineMonth: b.movingDeadlineMonth,
    movingAlreadySaved: eurosToCents(b.movingAlreadySaved),
    emergencyTarget: eurosToCents(b.emergencyTarget),
    emergencyExisting: eurosToCents(b.emergencyExisting),
    riskFreeRate: b.riskFreeRate,
    earlyRepaymentPct: b.earlyRepaymentPct,
  };
  const loans: LoanInput[] = s.loans.map((l) => ({
    id: l.id,
    name: l.id,
    principal: eurosToCents(l.principal),
    apr: l.apr,
    monthlyPayment: eurosToCents(l.monthlyPayment),
    ...(l.kind ? { kind: l.kind, limit: eurosToCents(l.limit ?? 0) } : {}),
  }));
  return { budget, loans };
}

describe.each(fixture.scenarios.map((s) => [s.id, s] as const))("reference scenario %s", (_, scenario) => {
  const { months } = simulatePlan(input(scenario));

  it("matches the Python reference on every month, to the cent", () => {
    const actual = months.map((m) => ({
      month: m.month,
      available: m.available,
      toEarlyRepayment: m.toEarlyRepayment,
      unusedEarlyRepayment: m.unusedEarlyRepayment,
      overdraftDraw: m.overdraftDraw,
      remainingDebt: m.remainingDebt,
      totalInterest: m.totalInterest,
      loans: m.loans.map((l) => ({
        interest: l.interest,
        paymentPaid: l.paymentPaid,
        earlyRepayment: l.earlyRepayment,
        draw: l.draw,
        endBalance: l.endBalance,
        baselineEndBalance: l.baselineEndBalance,
      })),
    }));
    expect(actual).toEqual(scenario.expected);
  });
});

const scenario = (id: string) => fixture.scenarios.find((s) => s.id === id)!;
const at = (months: PlanMonth[], i: number) => months[i - 1] as PlanMonth;

describe("overdraft rules (hand-checkable)", () => {
  it("adds agios monthly and repays the overdraft before a cheaper loan (AC-02, AC-03)", () => {
    const { months, loans } = simulatePlan(input(scenario("od_avalanche")));
    const m1 = at(months, 1);
    // 800 € at 16 %: 800 × 0.16 / 12 = 10,67 € of agios; 2 500 − 1 900 − 200 = 400 € available, 50 % → 200 €.
    expect(m1.loans[1]).toMatchObject({ interest: 1_067, paymentPaid: 0, earlyRepayment: 20_000, endBalance: 81_067 - 20_000 });
    expect(m1.loans[0]?.earlyRepayment).toBe(0);
    // Without the plan the account pays the agios: the overdraft stays at 800 € for 25 years.
    expect(months.every((m) => m.loans[1]!.baselineEndBalance === 80_000)).toBe(true);
    expect(loans.map((l) => [l.id, l.kind, l.priority])).toEqual([
      ["loan", "loan", 2],
      ["od", "overdraft", 1],
    ]);
  });

  it("stays available at 0 € and does not delay the debt-free month (AC-04)", () => {
    const { months, kpis } = simulatePlan(input(scenario("od_avalanche")));
    const cleared = months.findIndex((m) => m.loans[1]!.endBalance === 0);
    expect(cleared).toBeGreaterThan(0);
    expect(months.slice(cleared + 1).every((m) => m.loans[1]!.endBalance === 0 && m.loans[1]!.interest === 0)).toBe(true);
    const loanPaid = months.find((m) => m.loans[0]!.endBalance <= 1)!.month;
    expect(kpis.debtFreeMonth).toBe(loanPaid);
  });

  it("draws a negative month on the overdraft up to its limit, then drops the rest (AC-09)", () => {
    const { months } = simulatePlan(input(scenario("od_negative_months")));
    // Month 1: 200 € + 2 € of agios, 150 € short → 352 €.
    expect(at(months, 1)).toMatchObject({ available: -15_000, overdraftDraw: 15_000, negativeBudget: true });
    expect(at(months, 1).loans[0]).toMatchObject({ interest: 200, draw: 15_000, endBalance: 35_200 });
    const full = months.findIndex((m) => m.overdraftDraw < 15_000);
    expect(at(months, full + 1).loans[0]!.endBalance).toBeGreaterThanOrEqual(100_000);
    // At the limit, only the agios still grow it.
    const later = at(months, full + 2).loans[0]!;
    expect(later.draw).toBe(0);
  });

  it("uses only the fixed repayment when below the threshold (AC-07)", () => {
    const { months, loans } = simulatePlan(input(scenario("od_fixed_below_threshold")));
    expect(loans[0]).toMatchObject({ kind: "overdraft", eligible: false, paymentBelowInterest: false });
    expect(at(months, 1).loans[0]).toMatchObject({ paymentPaid: 10_000, earlyRepayment: 0 });
  });

  it("a plan without overdraft is unchanged by the new rules (AC-06)", () => {
    const plain = input(scenario("od_avalanche"));
    const loanOnly = { ...plain, loans: [plain.loans[0]!] };
    const { months } = simulatePlan(loanOnly);
    expect(months.every((m) => m.overdraftDraw === 0 && m.loans.every((l) => l.draw === 0))).toBe(true);
  });
});

describe("overdraft form validation (AC-05)", () => {
  const form = (over: Record<string, string> = {}) => ({
    name: "Compte courant",
    type: "",
    principal: "800",
    apr: "16",
    monthlyPayment: "",
    contractEndMonth: "",
    principalPaidThroughMonth: "",
    kind: "overdraft",
    creditLimit: "1 000",
    ...over,
  });

  it("accepts limit, balance, rate and an empty fixed repayment (0 €)", () => {
    expect(validateLoan(form(), 0)).toEqual({
      ok: true,
      value: {
        name: "Compte courant",
        type: "Découvert bancaire",
        principal: 80_000,
        principalPaidThroughMonth: null,
        apr: 0.16,
        monthlyPayment: 0,
        contractEndMonth: null,
        penaltyPct: null,
        penaltyCapMonths: null,
        kind: "overdraft",
        creditLimit: 100_000,
      },
    });
    expect(validateLoan(form({ principal: "0" }), 0).ok).toBe(true);
    expect(validateLoan(form({ principal: "1000" }), 0).ok).toBe(true);
  });

  it.each([
    [{ creditLimit: "0" }, "creditLimit", "L’autorisation doit être supérieure à 0"],
    [{ creditLimit: "" }, "creditLimit", "Montant requis"],
    [{ principal: "1000,01" }, "principal", "Le solde utilisé ne peut pas dépasser l’autorisation"],
    [{ principal: "-5" }, "principal", "Le montant ne peut pas être négatif"],
    [{ apr: "150" }, "apr", "Le taux doit être inférieur ou égal à 100 %"],
    [{ monthlyPayment: "-10" }, "monthlyPayment", "Le montant ne peut pas être négatif"],
    [{ principal: "10,001" }, "principal", "2 décimales maximum"],
  ])("rejects %j", (over, field, message) => {
    expect(validateLoan(form(over), 0)).toEqual({ ok: false, errors: { [field]: message } });
  });

  it("counts in the 6-debt limit", () => {
    expect(validateLoan(form(), 6)).toMatchObject({ ok: false, errors: { form: "6 crédits maximum" } });
  });
});

describe("AC-08 — check-ins take the overdraft balance", () => {
  const snapshot = (overdraftBalance: number): FinanceSnapshot =>
    makeSnapshot({
      settings: makeSettings({ startMonth: "2027-01" }),
      lines: [{ id: "i", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null }],
      loans: [makeLoan(1), makeLoan(2, { name: "Découvert", kind: "overdraft", principal: 30_000, monthlyPayment: 0, apr: 0.16, creditLimit: 100_000 })],
      actuals: [
        {
          id: "a",
          month: "2027-02",
          income: null,
          expenses: null,
          lines: [],
          emergencySavings: 0,
          freeSavings: 0,
          goalBalances: [{ goalId: "goal-primary", balance: 0 }],
          loanBalances: [
            { loanId: "loan-1", balance: 400_000 },
            { loanId: "loan-2", balance: overdraftBalance },
          ],
          frozen: null,
        } as MonthlyActual,
      ],
    });

  it("is a balance to enter like any loan, 0 allowed", () => {
    const form = {
      month: "2027-02",
      goalBalances: [{ goalId: "goal-primary", balance: "0" }],
      emergencySavings: "0",
      freeSavings: "0",
      loanBalances: [
        { loanId: "loan-1", balance: "4 000" },
        { loanId: "loan-2", balance: "0" },
      ],
    };
    const ctx = { startMonth: "2027-01", currentMonth: "2027-03", activeLoanIds: ["loan-1", "loan-2"], goalIds: ["goal-primary"] };
    expect(validateActual(form, ctx)).toMatchObject({ ok: true, value: { loanBalances: [{ balance: 400_000 }, { balance: 0 }] } });
    expect(validateActual({ ...form, loanBalances: [form.loanBalances[0]!] }, ctx)).toMatchObject({ ok: false, errors: { "loan.loan-2": "Montant requis" } });
  });

  it("counts in the actual debt compared with the plan", () => {
    const at = (balance: number) => computePlan(snapshot(balance), "2027-03")!.comparisons[0]!;
    expect(at(0).actualDebt).toBe(400_000);
    expect(at(25_000).actualDebt).toBe(425_000);
    expect(at(25_000).debtGap! - at(0).debtGap!).toBe(25_000);
  });
});
