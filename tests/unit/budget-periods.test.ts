/** Budget lines with a period (SPEC D15, issue #1): validation, reference month, plan input. */
import { describe, expect, it } from "vitest";
import { buildPlanInput, computePlan, referenceMonth, sumCategory } from "@/lib/domain/plan";
import type { BudgetLine, BudgetSettings, FinanceSnapshot } from "@/lib/domain/types";
import { type BudgetForm, validateBudget } from "@/lib/domain/validation";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  movingGoal: 0,
  movingDeadlineMonth: "2027-01",
  movingAlreadySaved: 0,
  emergencyTarget: 0,
  emergencyExisting: 0,
  riskFreeRate: 0.02,
  earlyRepaymentPct: 0,
};
const line = (id: string, category: BudgetLine["category"], amount: number, startMonth: string | null, endMonth: string | null): BudgetLine =>
  ({ id, category, label: id, amount, position: 0, startMonth, endMonth });
// Rent changes after the move: 850,00 € until June 2027, 1 100,00 € from July 2027.
const lines = [
  line("salary", "income", 280_000, null, null),
  line("rent-before", "fixed", 85_000, null, "2027-06"),
  line("rent-after", "fixed", 110_000, "2027-07", null),
];

describe("validateBudget with line periods", () => {
  const form: BudgetForm = {
    startMonth: "2027-01", movingGoal: "0", movingDeadlineMonth: "2027-06", movingAlreadySaved: "0",
    emergencyTarget: "0", emergencyExisting: "0", riskFreeRate: "2", earlyRepaymentPct: "50",
    lines: [{ category: "fixed", label: "Loyer", amount: "850", startMonth: "", endMonth: "2027-06" }],
  };

  it("accepts an optional period and keeps empty bounds as null", () => {
    const r = validateBudget(form);
    expect(r.ok && r.value.lines[0]).toMatchObject({ startMonth: null, endMonth: "2027-06" });
  });

  it("rejects an invalid month and an end before the start", () => {
    expect(validateBudget({ ...form, lines: [{ ...form.lines[0]!, startMonth: "2027-13" }] })).toMatchObject({
      ok: false, errors: { "lines.0.startMonth": "Mois invalide (AAAA-MM)" },
    });
    expect(validateBudget({ ...form, lines: [{ ...form.lines[0]!, startMonth: "2027-07", endMonth: "2027-06" }] })).toMatchObject({
      ok: false, errors: { "lines.0.endMonth": "La fin doit être après le début" },
    });
  });
});

describe("reference month and plan input", () => {
  it("keeps the reference month within the plan", () => {
    expect(referenceMonth("2027-01", "2026-09")).toBe("2027-01");
    expect(referenceMonth("2027-01", "2027-09")).toBe("2027-09");
    expect(referenceMonth("2027-01", "2060-01")).toBe("2051-12");
  });

  it("sums only the lines active in a month", () => {
    expect(sumCategory(lines, "fixed", "2027-06")).toBe(85_000);
    expect(sumCategory(lines, "fixed", "2027-07")).toBe(110_000);
    expect(sumCategory(lines, "fixed")).toBe(195_000);
  });

  it("passes dated lines to the engine and KPI sums for the reference month", () => {
    const input = buildPlanInput(settings, lines, [], [], "2027-09");
    expect(input.budget).toMatchObject({ income: 280_000, fixedCosts: 110_000 });
    expect(input.budget.lines).toHaveLength(3);
    // Without any period, the engine gets the constant sums only (unchanged behaviour).
    expect(buildPlanInput(settings, [line("s", "income", 1, null, null)], []).budget.lines).toBeUndefined();
  });

  it("computes the plan month by month and reports the reference month", () => {
    const snapshot: FinanceSnapshot = { settings, lines, exceptions: [], loans: [], archivedLoans: [], actuals: [] };
    const plan = computePlan(snapshot, "2027-03")!;
    expect(plan.referenceMonth).toBe("2027-03");
    expect(plan.result.kpis.monthlyExpenses).toBe(85_000);
    expect(plan.result.months[5]).toMatchObject({ month: "2027-06", expenses: 85_000 });
    expect(plan.result.months[6]).toMatchObject({ month: "2027-07", expenses: 110_000 });
  });
});
