import { describe, expect, it } from "vitest";
import {
  type BudgetFormState,
  computePreview,
  formSignature,
  initialFormState,
  invalidParams,
  isOutsidePlan,
  overlapWarnings,
  periodOverlap,
  sameNameKey,
  parsePayload,
  parseSettings,
  periodText,
  sectionTotal,
  toPayload,
} from "@/app/(app)/budget/budget-form-state";
import type { BudgetLine, BudgetSettings, Loan } from "@/lib/domain/types";
import { validateBudget } from "@/lib/domain/validation";
import { primaryGoal } from "../components/helpers";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 600000,
  emergencyExisting: 100000,
  freeSavingsExisting: 25000,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.5,
};

// The primary goal, now edited in the goals card (SPEC D23): 3 000 € by June 2027, 500 € saved.
const goals = [primaryGoal({ target: 300000, deadlineMonth: "2027-06", alreadySaved: 50000 })];

const lines: BudgetLine[] = [
  { id: "v1", category: "variable", label: "Courses", amount: 40000, position: 0, startMonth: null, endMonth: null },
  { id: "i2", category: "income", label: "Primes", amount: 10000, position: 1, startMonth: null, endMonth: null },
  { id: "f1", category: "fixed", label: "Loyer", amount: 80000, position: 0, startMonth: null, endMonth: null },
  { id: "i1", category: "income", label: "Salaire net", amount: 250000, position: 0, startMonth: null, endMonth: null },
];

const loan: Loan = {
  id: "l1",
  name: "Auto",
  type: null,
  principal: 500000,
  principalPaidThroughMonth: null,
  apr: 0.05,
  monthlyPayment: 20000,
  contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null,
  position: 0,
  archivedAt: null,
};

describe("initialFormState", () => {
  it("formats saved settings and sorts lines by category then position", () => {
    const state = initialFormState(settings, lines, "2026-09");
    expect(state.params).toEqual({
      startMonth: "2027-01",
      emergencyTarget: "6000,00",
      emergencyExisting: "1000,00",
      freeSavingsExisting: "250,00",
      riskFreeRate: "2,4",
      earlyRepaymentPct: "50",
      expenseInflationRate: "0",
      incomeGrowthRate: "0",
      emergencyRate: "0",
      freeSavingsRate: "0",
    });
    expect(state.lines.map((l) => l.id)).toEqual(["i1", "i2", "f1", "v1"]);
    expect(state.lines[0]).toEqual({
      key: "i1",
      id: "i1",
      category: "income",
      label: "Salaire net",
      amount: "2500,00",
      startMonth: "",
      endMonth: "",
    });
  });

  it("first visit: current month, empty rates, zero amounts", () => {
    const state = initialFormState(null, [], "2026-09");
    expect(state.params).toEqual({
      startMonth: "2026-09",
      emergencyTarget: "0",
      emergencyExisting: "0",
      freeSavingsExisting: "0",
      riskFreeRate: "",
      earlyRepaymentPct: "",
      expenseInflationRate: "0",
      incomeGrowthRate: "0",
      emergencyRate: "0",
      freeSavingsRate: "0",
    });
    expect(parseSettings(state.params)).toBeNull();
    expect(invalidParams(state.params)).toEqual(["riskFreeRate", "earlyRepaymentPct"]);
  });
});

describe("toPayload", () => {
  it("groups lines by category, keeps keys aligned, omits missing ids, and round-trips through validation", () => {
    const state: BudgetFormState = {
      params: initialFormState(settings, [], "2026-09").params,
      lines: [
        { key: "new-1", category: "fixed", label: "Internet", amount: "30", startMonth: "", endMonth: "" },
        { key: "i1", id: "i1", category: "income", label: "Salaire", amount: "2 500,50", startMonth: "", endMonth: "" },
        { key: "new-2", category: "income", label: "Autres", amount: "10", startMonth: "", endMonth: "" },
      ],
    };
    const payload = toPayload(state);
    expect(payload.keys).toEqual(["i1", "new-2", "new-1"]);
    expect(payload.form.lines[1]).toEqual({ category: "income", label: "Autres", amount: "10", startMonth: "", endMonth: "" });

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
    const freeEdited = { ...state, params: { ...state.params, freeSavingsExisting: "300" } };
    expect(formSignature(freeEdited)).not.toBe(formSignature(state));
  });

  it("round-trips the existing free savings (SPEC D16) through the payload and validation", () => {
    const state = initialFormState(settings, [], "2026-09");
    const parsed = parsePayload(JSON.stringify(toPayload(state)));
    expect(parsed?.form.freeSavingsExisting).toBe("250,00");
    const result = validateBudget(parsed!.form);
    expect(result.ok && result.value.settings).toEqual({ ...settings, expenseInflationRate: 0, incomeGrowthRate: 0, emergencyRate: 0, freeSavingsRate: 0 });

    // Empty = 0; a negative amount is reported on its own field.
    const empty = validateBudget({ ...parsed!.form, freeSavingsExisting: "" });
    expect(empty.ok && empty.value.settings.freeSavingsExisting).toBe(0);
    state.params.freeSavingsExisting = "-5";
    expect(invalidParams(state.params)).toEqual(["freeSavingsExisting"]);
  });
});

describe("parsePayload", () => {
  it.each([undefined, "not json", "[]", '{"form":{}}', '{"form":{"lines":"x"}}'])("rejects %s", (raw) => {
    expect(parsePayload(raw)).toBeNull();
  });

  it("coerces unexpected field types to empty strings", () => {
    const parsed = parsePayload(JSON.stringify({ form: { startMonth: 5, freeSavingsExisting: 12, lines: [{ id: 3, category: "income", label: null, amount: "1" }, 7] } }));
    expect(parsed?.form.startMonth).toBe("");
    expect(parsed?.form.freeSavingsExisting).toBe("");
    expect(parsed?.form.lines).toEqual([
      { category: "income", label: "", amount: "1", startMonth: "", endMonth: "" },
      { category: "", label: "", amount: "", startMonth: "", endMonth: "" },
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
    state.lines.push({ key: "new-1", category: "fixed", label: "Cassé", amount: "12,345", startMonth: "", endMonth: "" });
    const preview = computePreview(state, [loan], [], { goals });
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

  it("starts the simulated free savings from the existing free savings (SPEC D16)", () => {
    const state = initialFormState(settings, lines, "2026-09");
    const base = computePreview(state, [loan]).plan!;
    state.params.freeSavingsExisting = "1 000";
    const more = computePreview(state, [loan]).plan!;
    // 1 000 € instead of 250 €: every month's cumulative free savings is 750 € higher.
    expect(more.months[0]!.freeSavingsCumulative - base.months[0]!.freeSavingsCumulative).toBe(75000);
    expect(more.kpis.freeSavingsAt12 - base.kpis.freeSavingsAt12).toBe(75000);
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

describe("line periods (SPEC D15)", () => {
  // Rent 850,00 € until June 2027, then 1 100,00 € from July 2027.
  const dated: BudgetLine[] = [
    { id: "i1", category: "income", label: "Salaire", amount: 280000, position: 0, startMonth: null, endMonth: null },
    { id: "r1", category: "fixed", label: "Loyer", amount: 85000, position: 0, startMonth: null, endMonth: "2027-06" },
    { id: "r2", category: "fixed", label: "Loyer", amount: 110000, position: 1, startMonth: "2027-07", endMonth: null },
  ];

  it("starts from the saved periods and sends them back in the payload", () => {
    const state = initialFormState(settings, dated, "2026-09");
    expect(state.lines.map((l) => [l.id, l.startMonth, l.endMonth])).toEqual([
      ["i1", "", ""],
      ["r1", "", "2027-06"],
      ["r2", "2027-07", ""],
    ]);
    const payload = toPayload(state);
    expect(payload.form.lines[2]).toMatchObject({ id: "r2", startMonth: "2027-07", endMonth: "" });
    const parsed = parsePayload(JSON.stringify(payload));
    expect(parsed).toEqual(payload);
    const result = validateBudget(parsed!.form);
    expect(result.ok && result.value.lines.map((l) => [l.amount, l.startMonth, l.endMonth])).toEqual([
      [280000, null, null],
      [85000, null, "2027-06"],
      [110000, "2027-07", null],
    ]);
  });

  it("detects a period change through the signature", () => {
    const state = initialFormState(settings, dated, "2026-09");
    const edited = { ...state, lines: state.lines.map((l) => (l.id === "i1" ? { ...l, endMonth: "2030-12" } : l)) };
    expect(formSignature(edited)).not.toBe(formSignature(state));
    expect(formSignature(initialFormState(settings, dated, "2026-09"))).toBe(formSignature(state));
  });

  it("parsePayload keeps month strings only and caps their length", () => {
    const parsed = parsePayload(
      JSON.stringify({ form: { lines: [{ category: "fixed", startMonth: 202701, endMonth: `2027-06${"x".repeat(500)}` }] } }),
    );
    expect(parsed?.form.lines[0]?.startMonth).toBe("");
    expect(parsed?.form.lines[0]?.endMonth).toHaveLength(20);
    const result = validateBudget({ ...parsed!.form, ...initialFormState(settings, [], "2026-09").params });
    expect(result).toMatchObject({ ok: false, errors: { "lines.0.endMonth": "Mois invalide (AAAA-MM)" } });
  });

  it("totals and KPIs describe the reference month; the plan follows the periods month by month", () => {
    const state = initialFormState(settings, dated, "2026-09");
    // Before the plan start: reference = plan start (January 2027), old rent.
    const early = computePreview(state, [], [], { currentMonth: "2026-09" });
    expect(early).toMatchObject({ referenceMonth: "2027-01", hasPeriods: true, fixed: 85000, margin: 195000 });
    // During the plan: reference = current month (September 2027), new rent.
    const later = computePreview(state, [], [], { currentMonth: "2027-09" });
    expect(later).toMatchObject({ referenceMonth: "2027-09", fixed: 110000, margin: 170000 });
    expect(later.suggestedEmergencyTarget).toBe(3 * 110000);
    expect(sectionTotal(state.lines, "fixed", "2027-06")).toBe(85000);
    expect(sectionTotal(state.lines, "fixed", "2027-07")).toBe(110000);
    expect(sectionTotal(state.lines, "fixed")).toBe(195000);
    // The simulated months switch rent in July 2027 (month index 6).
    const months = later.plan!.months;
    expect(months[5]?.available).toBe(195000);
    expect(months[6]?.available).toBe(170000);
  });

  it("falls back to the saved start month while the typed one is invalid", () => {
    const state = initialFormState(settings, dated, "2026-09");
    state.params.startMonth = "2027-1";
    const preview = computePreview(state, [], [], { currentMonth: "2027-09", savedStartMonth: "2027-08" });
    expect(preview.plan).toBeNull();
    expect(preview.referenceMonth).toBe("2027-09");
    expect(preview.fixed).toBe(110000);
  });

  it("describes a period in words", () => {
    expect(periodText({ startMonth: null, endMonth: null })).toBeNull();
    expect(periodText({ startMonth: null, endMonth: "2027-06" })).toBe("jusqu’à juin 2027");
    expect(periodText({ startMonth: "2027-07", endMonth: null })).toBe("à partir de juil. 2027");
    expect(periodText({ startMonth: "2027-07", endMonth: "2027-12" })).toBe("de juil. 2027 à déc. 2027");
    expect(periodText({ startMonth: "2027-07", endMonth: "2027-07" })).toBe("en juil. 2027 uniquement");
  });

  it("flags a period entirely outside the 300 simulated months", () => {
    // Plan: 2027-01 … 2051-12.
    expect(isOutsidePlan({ startMonth: null, endMonth: "2026-12" }, "2027-01")).toBe(true);
    expect(isOutsidePlan({ startMonth: null, endMonth: "2027-01" }, "2027-01")).toBe(false);
    expect(isOutsidePlan({ startMonth: "2051-12", endMonth: null }, "2027-01")).toBe(false);
    expect(isOutsidePlan({ startMonth: "2052-01", endMonth: null }, "2027-01")).toBe(true);
    expect(isOutsidePlan({ startMonth: null, endMonth: "2020-01" }, null)).toBe(false);
  });
});

describe("same-name lines that overlap (#99)", () => {
  const row = (key: string, label: string, startMonth = "", endMonth = "", category: BudgetLine["category"] = "fixed") => ({
    key,
    category,
    label,
    amount: "850",
    startMonth,
    endMonth,
  });

  it("compares names ignoring case, accents and spaces", () => {
    expect(sameNameKey("  Loyér   Paris ")).toBe(sameNameKey("loyer paris"));
    expect(sameNameKey("Loyer")).not.toBe(sameNameKey("Loyers"));
  });

  it("computes the months two periods share, bounds inclusive", () => {
    expect(periodOverlap({ startMonth: null, endMonth: null }, { startMonth: "2027-07", endMonth: null })).toEqual({ startMonth: "2027-07", endMonth: null });
    expect(periodOverlap({ startMonth: null, endMonth: "2027-09" }, { startMonth: "2027-07", endMonth: null })).toEqual({ startMonth: "2027-07", endMonth: "2027-09" });
    expect(periodOverlap({ startMonth: null, endMonth: "2027-07" }, { startMonth: "2027-07", endMonth: null })).toEqual({ startMonth: "2027-07", endMonth: "2027-07" });
    expect(periodOverlap({ startMonth: null, endMonth: "2027-06" }, { startMonth: "2027-07", endMonth: null })).toBeNull();
  });

  it("AC-01 / AC-03 — flags both lines and names the months", () => {
    const warnings = overlapWarnings([row("a", "Loyer"), row("b", "loyer", "2027-07")]);
    expect(warnings).toEqual({
      a: "2 lignes « Loyer » actives à partir de juil. 2027",
      b: "2 lignes « loyer » actives à partir de juil. 2027",
    });
    expect(overlapWarnings([row("a", "Loyer"), row("b", "Loyer")]).a).toBe("2 lignes « Loyer » actives chaque mois");
  });

  it("AC-02 — periods that follow each other are not flagged", () => {
    expect(overlapWarnings([row("a", "Loyer", "", "2027-06"), row("b", "Loyer", "2027-07")])).toEqual({});
  });

  it("compares within the same category only, and ignores empty names", () => {
    expect(overlapWarnings([row("a", "Prime", "", "", "income"), row("b", "Prime", "", "", "variable")])).toEqual({});
    expect(overlapWarnings([row("a", " "), row("b", "")])).toEqual({});
  });

  it("counts three lines active together", () => {
    expect(overlapWarnings([row("a", "Loyer"), row("b", "Loyer"), row("c", "Loyer")]).a).toBe("3 lignes « Loyer » actives en même temps");
  });

  it("#121 — a line at 0 € (hidden template line, new line not filled in yet) neither counts nor warns", () => {
    const zero = (key: string, label: string, amount: string) => ({ ...row(key, label), amount });
    expect(overlapWarnings([zero("tpl", "Abonnements", "0,00"), row("new", "abonnements")])).toEqual({});
    expect(overlapWarnings([row("a", "Loyer"), zero("b", "loyer", "0")])).toEqual({});
    expect(overlapWarnings([row("a", "Loyer"), zero("b", "loyer", "")])).toEqual({});
  });
});
