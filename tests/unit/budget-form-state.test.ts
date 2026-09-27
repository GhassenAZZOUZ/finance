import { describe, expect, it } from "vitest";
import {
  type BudgetFormState,
  computePreview,
  formSignature,
  initialFormState,
  invalidParams,
  parsePayload,
  parseSettings,
  sectionTotal,
  toPayload,
} from "@/app/(app)/budget/budget-form-state";
import type { BudgetLine, BudgetSettings, Loan } from "@/lib/domain/types";
import { validateBudget } from "@/lib/domain/validation";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  movingGoal: 300000,
  movingDeadlineMonth: "2027-06",
  movingAlreadySaved: 50000,
  emergencyTarget: 600000,
  emergencyExisting: 100000,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.5,
};

const lines: BudgetLine[] = [
  { id: "v1", category: "variable", label: "Courses", amount: 40000, position: 0 },
  { id: "i2", category: "income", label: "Primes", amount: 10000, position: 1 },
  { id: "f1", category: "fixed", label: "Loyer", amount: 80000, position: 0 },
  { id: "i1", category: "income", label: "Salaire net", amount: 250000, position: 0 },
];

const loan: Loan = {
  id: "l1",
  name: "Auto",
  type: null,
  principal: 500000,
  apr: 0.05,
  monthlyPayment: 20000,
  contractEndMonth: null,
  position: 0,
  archivedAt: null,
};

describe("initialFormState", () => {
  it("formats saved settings and sorts lines by category then position", () => {
    const state = initialFormState(settings, lines, "2026-09");
    expect(state.params).toEqual({
      startMonth: "2027-01",
      movingGoal: "3000,00",
      movingDeadlineMonth: "2027-06",
      movingAlreadySaved: "500,00",
      emergencyTarget: "6000,00",
      emergencyExisting: "1000,00",
      riskFreeRate: "2,4",
      earlyRepaymentPct: "50",
    });
    expect(state.lines.map((l) => l.id)).toEqual(["i1", "i2", "f1", "v1"]);
    expect(state.lines[0]).toEqual({ key: "i1", id: "i1", category: "income", label: "Salaire net", amount: "2500,00" });
  });

  it("first visit: current month, empty deadline and rates, zero amounts", () => {
    const state = initialFormState(null, [], "2026-09");
    expect(state.params).toEqual({
      startMonth: "2026-09",
      movingGoal: "0",
      movingDeadlineMonth: "",
      movingAlreadySaved: "0",
      emergencyTarget: "0",
      emergencyExisting: "0",
      riskFreeRate: "",
      earlyRepaymentPct: "",
    });
    expect(parseSettings(state.params)).toBeNull();
    expect(invalidParams(state.params)).toEqual(["movingDeadlineMonth", "riskFreeRate", "earlyRepaymentPct"]);
  });
});

describe("toPayload", () => {
  it("groups lines by category, keeps keys aligned, omits missing ids, and round-trips through validation", () => {
    const state: BudgetFormState = {
      params: initialFormState(settings, [], "2026-09").params,
      lines: [
        { key: "new-1", category: "fixed", label: "Internet", amount: "30" },
        { key: "i1", id: "i1", category: "income", label: "Salaire", amount: "2 500,50" },
        { key: "new-2", category: "income", label: "Autres", amount: "10" },
      ],
    };
    const payload = toPayload(state);
    expect(payload.keys).toEqual(["i1", "new-2", "new-1"]);
    expect(payload.form.lines[1]).toEqual({ category: "income", label: "Autres", amount: "10" });

    const parsed = parsePayload(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
    const result = validateBudget(parsed!.form);
    expect(result.ok && result.value.lines.map((l) => [l.category, l.position, l.amount])).toEqual([
      ["income", 0, 250050],
      ["income", 1, 1000],
      ["fixed", 0, 3000],
    ]);
  });

  it("detects changes through the signature", () => {
    const state = initialFormState(settings, lines, "2026-09");
    const edited = { ...state, lines: state.lines.map((l, i) => (i === 0 ? { ...l, amount: "2500" } : l)) };
    expect(formSignature(state)).toBe(formSignature(initialFormState(settings, lines, "2026-09")));
    expect(formSignature(edited)).not.toBe(formSignature(state));
  });
});

describe("parsePayload", () => {
  it.each([undefined, "not json", "[]", '{"form":{}}', '{"form":{"lines":"x"}}'])("rejects %s", (raw) => {
    expect(parsePayload(raw)).toBeNull();
  });

  it("coerces unexpected field types to empty strings", () => {
    const parsed = parsePayload(JSON.stringify({ form: { startMonth: 5, lines: [{ id: 3, category: "income", label: null, amount: "1" }, 7] } }));
    expect(parsed?.form.startMonth).toBe("");
    expect(parsed?.form.lines).toEqual([
      { category: "income", label: "", amount: "1" },
      { category: "", label: "", amount: "" },
    ]);
    expect(parsed?.keys).toEqual(["0", "1"]);
  });

  it("rejects too many lines", () => {
    const form = { lines: Array.from({ length: 3 }, () => ({})) };
    expect(parsePayload(JSON.stringify({ form }), 2)).toBeNull();
  });
});

describe("computePreview", () => {
  it("sums valid amounts, skips invalid ones and simulates when parameters are valid", () => {
    const state = initialFormState(settings, lines, "2026-09");
    state.lines.push({ key: "new-1", category: "fixed", label: "Cassé", amount: "12,345" });
    const preview = computePreview(state, [loan]);
    expect(preview).toMatchObject({
      income: 260000,
      fixed: 80000,
      variable: 40000,
      loanPayments: 20000,
      margin: 120000,
      invalidAmounts: 1,
      suggestedEmergencyTarget: 3 * (80000 + 40000 + 20000),
      debtAlert: "ok",
    });
    expect(preview.debtRatio).toBeCloseTo(20000 / 260000);
    expect(preview.plan?.months).toHaveLength(300);
    expect(preview.plan?.months[0]?.available).toBe(120000);
    expect(preview.plan?.kpis.movingMonthlyNeeded).toBe(41667); // 2500 € / 6 months
    expect(sectionTotal(state.lines, "fixed")).toBe(80000);
  });

  it("has no plan while a parameter is invalid, but still shows the totals", () => {
    const state = initialFormState(settings, lines, "2026-09");
    state.params.riskFreeRate = "abc";
    const preview = computePreview(state, []);
    expect(preview.plan).toBeNull();
    expect(preview.income).toBe(260000);
    expect(invalidParams(state.params)).toEqual(["riskFreeRate"]);
  });

  it("reports a null debt ratio when income is 0 and alert levels above 30 / 35 %", () => {
    const zero = computePreview(initialFormState(settings, [], "2026-09"), [loan]);
    expect(zero.debtRatio).toBeNull();
    expect(zero.margin).toBe(-20000);

    const at = (income: number) =>
      computePreview(initialFormState(settings, [{ ...lines[3]!, amount: income }], "2026-09"), [loan]).debtAlert;
    expect(at(66000)).toBe("warning"); // 30.3 %
    expect(at(50000)).toBe("alert"); // 40 %
    expect(at(66667)).toBe("ok"); // 29.99 %
  });
});
