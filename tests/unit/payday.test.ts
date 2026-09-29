/** Income paydays (issue #60, SPEC D29): usual payday per income line, per-month exceptions. */
import { describe, expect, it } from "vitest";
import { initialFormState, parsePayload, toPayload } from "@/app/(app)/budget/budget-form-state";
import { daysInMonth, effectivePayDate, expectedPayDate, incomeLinesFor, isIsoDate, paidOnBounds } from "@/lib/domain/payday";
import type { BudgetLine, IncomePayment } from "@/lib/domain/types";
import { type BudgetForm, parsePaidOn, parsePaydayDay, validateBudget } from "@/lib/domain/validation";
import { currentDate, formatDate } from "@/lib/format";

const salary = (overrides: Partial<BudgetLine> = {}): BudgetLine => ({
  id: "a",
  category: "income",
  label: "Salaire A",
  amount: 250_000,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...overrides,
});

describe("expected payday (AC-01, AC-07)", () => {
  it("defaults to the 1st of the month itself", () => {
    expect(expectedPayDate(salary(), "2026-10")).toBe("2026-10-01");
  });

  it("uses the day of the previous month", () => {
    expect(expectedPayDate(salary({ paydayDay: 27, paydayPreviousMonth: true }), "2026-10")).toBe("2026-09-27");
    expect(expectedPayDate(salary({ paydayDay: 5 }), "2026-10")).toBe("2026-10-05");
  });

  it("takes a short month's last day", () => {
    const line = salary({ paydayDay: 31, paydayPreviousMonth: true });
    expect(expectedPayDate(line, "2026-10")).toBe("2026-09-30");
    expect(expectedPayDate(line, "2027-03")).toBe("2027-02-28");
    expect(expectedPayDate(line, "2028-03")).toBe("2028-02-29");
  });

  it("crosses the year boundary", () => {
    expect(expectedPayDate(salary({ paydayDay: 29, paydayPreviousMonth: true }), "2027-01")).toBe("2026-12-29");
  });

  it("prefers the month's exception", () => {
    const payments: IncomePayment[] = [{ month: "2026-10", budgetLineId: "a", paidOn: "2026-09-26" }];
    const line = salary({ paydayDay: 27, paydayPreviousMonth: true });
    expect(effectivePayDate(line, "2026-10", payments)).toBe("2026-09-26");
    expect(effectivePayDate(line, "2026-11", payments)).toBe("2026-10-27");
  });
});

describe("income lines of a month", () => {
  it("keeps active income lines with an amount", () => {
    const lines = [
      salary(),
      salary({ id: "zero", amount: 0 }),
      salary({ id: "later", startMonth: "2027-01" }),
      { ...salary({ id: "rent" }), category: "fixed" as const },
    ];
    expect(incomeLinesFor(lines, "2026-10").map((l) => l.id)).toEqual(["a"]);
    expect(incomeLinesFor(lines, "2027-01").map((l) => l.id)).toEqual(["a", "later"]);
  });
});

describe("dates", () => {
  it("knows the length of months", () => {
    expect([daysInMonth("2026-02"), daysInMonth("2028-02"), daysInMonth("2026-09"), daysInMonth("2026-10")]).toEqual([28, 29, 30, 31]);
  });

  it("checks YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-09-30")).toBe(true);
    expect(isIsoDate("2026-09-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("30/09/2026")).toBe(false);
  });

  it("reads today in Paris and formats dates the French way", () => {
    expect(currentDate(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
    expect(currentDate(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09-30");
    expect(formatDate("2026-09-27")).toBe("27/09/2026");
  });
});

describe("AC-04 — exception dates", () => {
  const today = "2026-09-26";

  it("accepts a date from the 1st of the month before to today", () => {
    expect(paidOnBounds("2026-10")).toEqual({ first: "2026-09-01", last: "2026-10-31" });
    expect(parsePaidOn("2026-09-26", "2026-10", today)).toEqual({ ok: true, value: "2026-09-26" });
    expect(parsePaidOn("2026-09-01", "2026-10", today)).toEqual({ ok: true, value: "2026-09-01" });
  });

  it("refuses a future date, a date out of bounds or a malformed one", () => {
    expect(parsePaidOn("2026-09-27", "2026-10", today)).toEqual({ ok: false, error: "La date ne peut pas être dans le futur" });
    expect(parsePaidOn("2026-08-31", "2026-10", today)).toEqual({
      ok: false,
      error: "La date doit être entre le 01/09/2026 et le 31/10/2026",
    });
    expect(parsePaidOn("2026-11-01", "2026-10", "2026-11-05")).toEqual({
      ok: false,
      error: "La date doit être entre le 01/09/2026 et le 31/10/2026",
    });
    expect(parsePaidOn("26/09/2026", "2026-10", today)).toEqual({ ok: false, error: "Date invalide" });
    expect(parsePaidOn("", "2026-10", today)).toEqual({ ok: false, error: "Date requise" });
  });

  it("validates the usual payday", () => {
    expect(parsePaydayDay("")).toEqual({ ok: true, value: 1 });
    expect(parsePaydayDay("27")).toEqual({ ok: true, value: 27 });
    for (const bad of ["0", "32", "x", "2,5"]) expect(parsePaydayDay(bad)).toEqual({ ok: false, error: "Jour entre 1 et 31" });
  });
});

describe("the budget form carries the payday of income lines", () => {
  const form: BudgetForm = {
    startMonth: "2027-01",
    emergencyTarget: "0",
    emergencyExisting: "0",
    riskFreeRate: "2",
    earlyRepaymentPct: "50",
    lines: [
      { category: "income", label: "Salaire A", amount: "2500", paydayDay: "27", paydayPreviousMonth: true },
      { category: "fixed", label: "Loyer", amount: "900", paydayDay: "5" },
    ],
  };

  it("keeps it on income lines only, and reports a bad day on its line", () => {
    const r = validateBudget(form);
    expect(r.ok && r.value.lines[0]).toMatchObject({ paydayDay: 27, paydayPreviousMonth: true });
    expect(r.ok && r.value.lines[1]).not.toHaveProperty("paydayDay");
    expect(validateBudget({ ...form, lines: [{ ...form.lines[0]!, paydayDay: "40" }] })).toMatchObject({
      ok: false,
      errors: { "lines.0.paydayDay": "Jour entre 1 et 31" },
    });
  });

  it("round-trips through the form state and the payload", () => {
    const state = initialFormState(null, [salary({ paydayDay: 27, paydayPreviousMonth: true })], "2026-09");
    expect(state.lines[0]).toMatchObject({ paydayDay: "27", paydayPreviousMonth: true });
    const parsed = parsePayload(JSON.stringify(toPayload(state)));
    expect(parsed?.form.lines[0]).toMatchObject({ paydayDay: "27", paydayPreviousMonth: true });
    // A default payday is left out of the payload (the saved value stays 1 of the same month).
    expect(toPayload(initialFormState(null, [salary()], "2026-09")).form.lines[0]).not.toHaveProperty("paydayDay");
  });
});
