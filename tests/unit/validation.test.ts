/**
 * Form validation checks required by the brief: negative amounts, APR bounds, max 6 loans,
 * complete monthly check-ins. The forms and the server actions share these validators.
 */
import { describe, expect, it } from "vitest";
import {
  type ActualForm,
  type BudgetForm,
  parseAmount,
  parsePercent,
  validateActual,
  validateBudget,
  validateLoan,
} from "@/lib/domain/validation";
import { amountInputValue, currentYearMonth, formatEuros, formatMonthShort, percentInputValue } from "@/lib/format";

describe("parseAmount", () => {
  it.each([
    ["1234,56", 123456],
    ["1 234,56", 123456],
    ["1 234,5 €", 123450],
    ["245.3", 24530],
    ["0", 0],
  ])("parses %s", (raw, cents) => {
    expect(parseAmount(raw)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ["-5", "Le montant ne peut pas être négatif"],
    ["12,345", "2 décimales maximum"],
    ["abc", "Montant invalide"],
    ["", "Montant requis"],
    ["99999999999", "Montant trop élevé"],
  ])("rejects %s", (raw, error) => {
    expect(parseAmount(raw)).toEqual({ ok: false, error });
  });

  it("allows an empty optional amount", () => {
    expect(parseAmount("", { required: false })).toEqual({ ok: true, value: null });
  });
});

describe("parsePercent (APR bounds)", () => {
  it("converts a percentage to a clean fraction", () => {
    expect(parsePercent("18,9")).toEqual({ ok: true, value: 0.189 });
    expect(parsePercent("0")).toEqual({ ok: true, value: 0 });
    expect(parsePercent("100")).toEqual({ ok: true, value: 1 });
  });

  it.each([
    ["-1", "Le taux ne peut pas être négatif"],
    ["100,01", "Le taux doit être inférieur ou égal à 100 %"],
    ["1,23456", "4 décimales maximum"],
    ["", "Taux requis"],
  ])("rejects %s", (raw, error) => {
    expect(parsePercent(raw)).toEqual({ ok: false, error });
  });
});

describe("validateLoan", () => {
  const form = {
    name: "Prêt auto",
    type: "Prêt affecté",
    principal: "8 200",
    apr: "4,9",
    monthlyPayment: "245,30",
    contractEndMonth: "",
  };

  it("accepts a valid loan", () => {
    expect(validateLoan(form, 3)).toEqual({
      ok: true,
      value: {
        name: "Prêt auto",
        type: "Prêt affecté",
        principal: 820000,
        apr: 0.049,
        monthlyPayment: 24530,
        contractEndMonth: null,
      },
    });
  });

  it("accepts an optional contract end month and rejects an invalid one", () => {
    expect(validateLoan({ ...form, contractEndMonth: "2029-06" }, 0)).toMatchObject({
      ok: true,
      value: { contractEndMonth: "2029-06" },
    });
    expect(validateLoan({ ...form, contractEndMonth: "2029-13" }, 0)).toMatchObject({
      ok: false,
      errors: { contractEndMonth: "Mois invalide (AAAA-MM)" },
    });
  });

  it("refuses a 7th active loan", () => {
    const result = validateLoan(form, 6);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.form).toBe("6 crédits maximum");
  });

  it("rejects negative or zero amounts and an APR above 100 %", () => {
    const result = validateLoan({ ...form, principal: "-10", monthlyPayment: "0", apr: "150" }, 0);
    expect(!result.ok && result.errors).toEqual({
      principal: "Le montant ne peut pas être négatif",
      monthlyPayment: "La mensualité doit être supérieure à 0",
      apr: "Le taux doit être inférieur ou égal à 100 %",
    });
  });

  it("allows a 0 % personal debt without a name", () => {
    const result = validateLoan({ ...form, name: " ", apr: "0" }, 0);
    expect(result.ok && result.value).toMatchObject({ name: null, apr: 0 });
  });
});

describe("validateBudget", () => {
  const form: BudgetForm = {
    startMonth: "2027-01",
    movingGoal: "4000",
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: "500",
    emergencyTarget: "4000",
    emergencyExisting: "800",
    riskFreeRate: "2,4",
    earlyRepaymentPct: "60",
    lines: [
      { id: "l1", category: "income", label: "Salaire", amount: "2800" },
      { category: "fixed", label: "Loyer", amount: "850" },
      { category: "income", label: "Autres", amount: "100" },
    ],
  };

  it("accepts a valid budget and numbers positions per category", () => {
    const result = validateBudget(form);
    expect(result.ok && result.value.settings).toMatchObject({ riskFreeRate: 0.024, earlyRepaymentPct: 0.6, movingGoal: 400000 });
    expect(result.ok && result.value.lines.map((l) => [l.category, l.position])).toEqual([
      ["income", 0],
      ["fixed", 0],
      ["income", 1],
    ]);
  });

  it("reports every invalid field", () => {
    const result = validateBudget({
      ...form,
      startMonth: "2027-13",
      earlyRepaymentPct: "120",
      lines: [{ category: "fixed", label: " ", amount: "-3" }],
    });
    expect(!result.ok && result.errors).toEqual({
      startMonth: "Mois invalide (AAAA-MM)",
      earlyRepaymentPct: "Le taux doit être inférieur ou égal à 100 %",
      "lines.0.label": "Libellé requis",
      "lines.0.amount": "Le montant ne peut pas être négatif",
    });
  });
});

describe("validateActual (complete check-ins only)", () => {
  const ctx = { startMonth: "2027-01", currentMonth: "2027-04", activeLoanIds: ["a", "b"] };
  const form: ActualForm = {
    month: "2027-03",
    income: "",
    expenses: "1 700",
    movingSavings: "900",
    emergencySavings: "800",
    freeSavings: "0",
    loanBalances: [
      { loanId: "a", balance: "7 900" },
      { loanId: "b", balance: "0" },
    ],
  };

  it("accepts a complete month; income and expenses are optional", () => {
    const result = validateActual(form, ctx);
    expect(result.ok && result.value).toMatchObject({ income: null, expenses: 170000, loanBalances: [{ balance: 790000 }, { balance: 0 }] });
  });

  it("requires every savings balance and every active loan balance", () => {
    const result = validateActual({ ...form, freeSavings: "", loanBalances: [{ loanId: "a", balance: "1" }] }, ctx);
    expect(!result.ok && result.errors).toEqual({ freeSavings: "Montant requis", "loan.b": "Montant requis" });
  });

  it("rejects months before the plan start or in the future", () => {
    expect(validateActual({ ...form, month: "2026-12" }, ctx)).toMatchObject({ ok: false, errors: { month: "Mois antérieur au début du plan" } });
    expect(validateActual({ ...form, month: "2027-05" }, ctx)).toMatchObject({ ok: false, errors: { month: "Impossible de saisir un mois futur" } });
  });
});

describe("formatting", () => {
  it("formats euros, months and input values the French way", () => {
    expect(formatEuros(123456).replace(/\s/g, " ")).toBe("1 234,56 €");
    expect(formatMonthShort("2027-01")).toBe("janv. 2027");
    expect(amountInputValue(24530)).toBe("245,30");
    expect(percentInputValue(0.189)).toBe("18,9");
  });

  it("gives the current month in Paris time", () => {
    // 31 Dec 2026 23:30 UTC is already January 2027 in Paris.
    expect(currentYearMonth(new Date(Date.UTC(2026, 11, 31, 23, 30)))).toBe("2027-01");
  });
});
