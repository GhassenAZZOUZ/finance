/** Yearly indexation of the budget (issue #36, SPEC D27): every January, per line, from the plan start. */
import { describe, expect, it } from "vitest";
import { buildPlanInput, isIndexed, sumCategory } from "@/lib/domain/plan";
import type { BudgetLine, BudgetSettings, Loan } from "@/lib/domain/types";
import { type BudgetForm, parseYearlyRate, validateBudget } from "@/lib/domain/validation";
import { type PlanResult, indexationYears, indexedAmount, simulatePlan } from "@/lib/engine";

const base: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 0,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.02,
  earlyRepaymentPct: 0,
};
const line = (id: string, category: BudgetLine["category"], amount: number, extra: Partial<BudgetLine> = {}): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...extra,
});
const loan: Loan = {
  id: "car",
  name: "Auto",
  type: null,
  principal: 1_000_000,
  principalPaidThroughMonth: null,
  apr: 0.05,
  monthlyPayment: 30_000,
  contractEndMonth: null,
  penaltyPct: null,
  penaltyCapMonths: null,
  kind: "loan",
  creditLimit: null,
  position: 0,
  archivedAt: null,
};

function plan(settings: BudgetSettings, lines: BudgetLine[], loans: Loan[] = [], exceptions: { month: string; kind: "income" | "expense"; amount: number }[] = []) {
  return simulatePlan(buildPlanInput(settings, lines, loans, exceptions, settings.startMonth));
}
const at = (result: PlanResult, month: string) => result.months.find((m) => m.month === month)!;

describe("indexation helpers", () => {
  it("counts the Januaries since the start month", () => {
    expect(indexationYears("2027-01", "2027-12")).toBe(0);
    expect(indexationYears("2027-01", "2028-01")).toBe(1);
    expect(indexationYears("2027-10", "2027-12")).toBe(0);
    expect(indexationYears("2027-10", "2028-01")).toBe(1);
    expect(indexationYears("2027-12", "2028-01")).toBe(1);
    expect(indexationYears("2027-01", "2026-12")).toBe(0);
  });

  it("indexes from the entered amount, rounded half away from zero", () => {
    expect(indexedAmount(100_000, 0.02, 2)).toBe(104_040);
    expect(indexedAmount(1_050, 0.05, 1)).toBe(1_103); // 1 102,5 cents
    expect(indexedAmount(100_000, 0.02, 0)).toBe(100_000);
    expect(indexedAmount(100_000, -1, 1)).toBe(0);
  });
});

describe("AC-01 — rates at 0 = results unchanged", () => {
  it("gives the same plan with rates 0 as without them", () => {
    const lines = [line("salary", "income", 300_000), line("rent", "fixed", 100_000), line("food", "variable", 40_000)];
    const without = plan(base, lines, [loan]);
    const zero = plan({ ...base, expenseInflationRate: 0, incomeGrowthRate: 0 }, lines, [loan]);
    expect(zero).toEqual(without);
    expect(isIndexed({ expenseInflationRate: 0, incomeGrowthRate: 0 })).toBe(false);
    expect(buildPlanInput({ ...base, expenseInflationRate: 0 }, lines, [], [], "2027-01").budget.lines).toBeUndefined();
  });
});

describe("AC-02 — expenses rise every January", () => {
  const lines = [line("salary", "income", 300_000), line("rent", "fixed", 100_000)];

  it("steps in January of each calendar year from a January start", () => {
    const result = plan({ ...base, expenseInflationRate: 0.02 }, lines);
    expect(at(result, "2027-01").expenses).toBe(100_000);
    expect(at(result, "2027-12").expenses).toBe(100_000);
    expect(at(result, "2028-01").expenses).toBe(102_000);
    expect(at(result, "2028-12").expenses).toBe(102_000);
    expect(at(result, "2029-01").expenses).toBe(104_040);
    expect(at(result, "2027-06").income).toBe(300_000);
    expect(at(result, "2029-06").income).toBe(300_000);
  });

  it("steps at the first January after a later start", () => {
    const result = plan({ ...base, startMonth: "2027-10", expenseInflationRate: 0.02 }, lines);
    expect(at(result, "2027-12").expenses).toBe(100_000);
    expect(at(result, "2028-01").expenses).toBe(102_000);
  });

  it("reaches (1 + r)^25 in month 300 of a plan starting in October", () => {
    const result = plan({ ...base, startMonth: "2027-10", expenseInflationRate: 0.02 }, lines);
    const last = result.months[299]!;
    expect(last.month).toBe("2052-09");
    expect(last.expenses).toBe(indexedAmount(100_000, 0.02, 25));
  });
});

describe("AC-03 — income grows every January, and can go down", () => {
  it("grows by the income rate", () => {
    const result = plan({ ...base, incomeGrowthRate: 0.015 }, [line("salary", "income", 250_000)]);
    expect(at(result, "2027-12").income).toBe(250_000);
    expect(at(result, "2028-01").income).toBe(253_750);
  });

  it("accepts a negative rate", () => {
    const result = plan({ ...base, incomeGrowthRate: -0.1 }, [line("salary", "income", 250_000)]);
    expect(at(result, "2028-01").income).toBe(225_000);
  });
});

describe("AC-04 — loan payments and exceptions are not indexed", () => {
  it("keeps the loan payment and adds exactly the exception", () => {
    const lines = [line("salary", "income", 500_000), line("rent", "fixed", 100_000)];
    const result = plan({ ...base, expenseInflationRate: 0.02 }, lines, [loan], [{ month: "2028-03", kind: "expense", amount: 50_000 }]);
    const march = at(result, "2028-03");
    expect(march.loanPayments).toBe(30_000);
    expect(march.extraExpenses).toBe(50_000);
    expect(march.expenses).toBe(102_000 + 50_000);
  });
});

describe("AC-05 — a line marked « non indexé » stays constant", () => {
  it("keeps its amount while the others rise", () => {
    const lines = [line("salary", "income", 300_000), line("rent", "fixed", 100_000), line("sub", "variable", 1_000, { indexed: false })];
    const result = plan({ ...base, expenseInflationRate: 0.02 }, lines);
    expect(at(result, "2031-01").expenses).toBe(indexedAmount(100_000, 0.02, 4) + 1_000);
  });
});

describe("dated lines (D15) are indexed from the plan start", () => {
  it("applies the years elapsed since the start, not since the line's own start", () => {
    const lines = [line("salary", "income", 300_000), line("rent", "fixed", 100_000, { startMonth: "2030-01" })];
    const result = plan({ ...base, expenseInflationRate: 0.02 }, lines);
    expect(at(result, "2029-12").expenses).toBe(0);
    expect(at(result, "2030-01").expenses).toBe(indexedAmount(100_000, 0.02, 3));
  });
});

describe("AC-07 — KPIs describe the reference month at its indexed amounts", () => {
  it("indexes the KPI sums to the reference month", () => {
    const settings = { ...base, expenseInflationRate: 0.02, incomeGrowthRate: 0.015 };
    const lines = [line("salary", "income", 250_000), line("rent", "fixed", 100_000), line("food", "variable", 40_000)];
    const input = buildPlanInput(settings, lines, [], [], "2029-05");
    expect(input.budget.income).toBe(indexedAmount(250_000, 0.015, 2));
    expect(input.budget.fixedCosts).toBe(104_040);
    expect(input.budget.variableExpenses).toBe(indexedAmount(40_000, 0.02, 2));
    expect(sumCategory(lines, "fixed", "2029-05")).toBe(100_000);
  });
});

describe("AC-06 — invalid rates are rejected", () => {
  const form: BudgetForm = {
    startMonth: "2027-01",
    emergencyTarget: "0",
    emergencyExisting: "0",
    riskFreeRate: "2",
    earlyRepaymentPct: "50",
    expenseInflationRate: "2",
    incomeGrowthRate: "-1,5",
    lines: [{ category: "fixed", label: "Abonnement", amount: "10", indexed: false }],
  };

  it("parses rates from −100 % to 100 %, empty = 0", () => {
    expect(parseYearlyRate("")).toEqual({ ok: true, value: 0 });
    expect(parseYearlyRate("2,5 %")).toEqual({ ok: true, value: 0.025 });
    expect(parseYearlyRate("−100")).toEqual({ ok: true, value: -1 });
    expect(parseYearlyRate("100")).toEqual({ ok: true, value: 1 });
  });

  it("keeps the rates and the « non indexé » flag", () => {
    const r = validateBudget(form);
    expect(r.ok && r.value.settings).toMatchObject({ expenseInflationRate: 0.02, incomeGrowthRate: -0.015 });
    expect(r.ok && r.value.lines[0]).toMatchObject({ indexed: false });
  });

  it("rejects out-of-range and non-numeric rates in French", () => {
    expect(validateBudget({ ...form, expenseInflationRate: "-101" })).toMatchObject({
      ok: false,
      errors: { expenseInflationRate: "Le taux doit être compris entre −100 % et 100 %" },
    });
    expect(validateBudget({ ...form, incomeGrowthRate: "150" })).toMatchObject({
      ok: false,
      errors: { incomeGrowthRate: "Le taux doit être compris entre −100 % et 100 %" },
    });
    expect(validateBudget({ ...form, incomeGrowthRate: "abc" })).toMatchObject({ ok: false, errors: { incomeGrowthRate: "Taux invalide" } });
  });
});
