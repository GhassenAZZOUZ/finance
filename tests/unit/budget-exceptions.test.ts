import { describe, expect, it } from "vitest";
import { type BudgetFormState, computePreview, initialFormState } from "@/app/(app)/budget/budget-form-state";
import {
  EMPTY_EXCEPTION_FORM,
  affectedMonthCount,
  defaultExceptionMonth,
  groupExceptionsByMonth,
  planPeriodStatus,
  readExceptionForm,
  readExceptionId,
} from "@/app/(app)/budget/exceptions-view";
import type { BudgetException, BudgetLine, BudgetSettings } from "@/lib/domain/types";

const ex = (id: string, month: string, kind: "income" | "expense", amount = 10000): BudgetException => ({
  id,
  month,
  kind,
  label: id,
  amount,
});

describe("planPeriodStatus", () => {
  it("classifies months against [start, start + 300)", () => {
    expect(planPeriodStatus("2026-12", "2027-01")).toBe("before");
    expect(planPeriodStatus("2027-01", "2027-01")).toBe("inside");
    expect(planPeriodStatus("2051-12", "2027-01")).toBe("inside"); // month 300
    expect(planPeriodStatus("2052-01", "2027-01")).toBe("after");
  });
});

describe("groupExceptionsByMonth", () => {
  const list = [ex("b", "2027-05", "expense"), ex("a", "2027-03", "income"), ex("c", "2027-05", "income"), ex("old", "2026-01", "expense")];

  it("groups by month in chronological order and keeps entry order within a month", () => {
    const groups = groupExceptionsByMonth(list, "2027-01");
    expect(groups.map((g) => g.month)).toEqual(["2026-01", "2027-03", "2027-05"]);
    expect(groups[2]?.items.map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("flags months outside the plan period", () => {
    const groups = groupExceptionsByMonth(list, "2027-01");
    expect(groups.map((g) => g.inPlan)).toEqual([false, true, true]);
  });

  it("treats every month as inside when there is no plan start", () => {
    expect(groupExceptionsByMonth(list, null).every((g) => g.inPlan)).toBe(true);
  });

  it("returns nothing for no exceptions", () => {
    expect(groupExceptionsByMonth([], "2027-01")).toEqual([]);
  });
});

describe("affectedMonthCount", () => {
  it("counts distinct months inside the plan period", () => {
    const list = [ex("a", "2027-03", "income"), ex("b", "2027-03", "expense"), ex("c", "2027-08", "expense"), ex("d", "2020-01", "income")];
    expect(affectedMonthCount(list, "2027-01")).toBe(2);
    expect(affectedMonthCount(list, null)).toBe(3);
    expect(affectedMonthCount([], "2027-01")).toBe(0);
  });
});

describe("defaultExceptionMonth", () => {
  it("uses the plan start, else the current month", () => {
    expect(defaultExceptionMonth("2027-01", "2026-09")).toBe("2027-01");
    expect(defaultExceptionMonth(null, "2026-09")).toBe("2026-09");
  });
});

describe("form parsing", () => {
  it("reads the fields as strings, missing ones as empty", () => {
    const fd = new FormData();
    fd.set("month", "2027-04");
    fd.set("kind", "income");
    fd.set("label", "Prime");
    expect(readExceptionForm(fd)).toEqual({ month: "2027-04", kind: "income", label: "Prime", amount: "" });
    expect(readExceptionForm(new FormData())).toEqual({ month: "", kind: "", label: "", amount: "" });
  });

  it("bounds oversized input", () => {
    const fd = new FormData();
    fd.set("label", "x".repeat(1000));
    fd.set("amount", "9".repeat(1000));
    const form = readExceptionForm(fd);
    expect(form.label.length).toBe(200);
    expect(form.amount.length).toBe(50);
  });

  it("reads the id to delete", () => {
    const fd = new FormData();
    expect(readExceptionId(fd)).toBeNull();
    fd.set("id", "  ");
    expect(readExceptionId(fd)).toBeNull();
    fd.set("id", "abc");
    expect(readExceptionId(fd)).toBe("abc");
    fd.set("id", "x".repeat(101));
    expect(readExceptionId(fd)).toBeNull();
  });

  it("has an empty default form", () => {
    expect(EMPTY_EXCEPTION_FORM).toEqual({ month: "", kind: "expense", label: "", amount: "" });
  });
});

describe("computePreview with exceptions", () => {
  const settings: BudgetSettings = {
    startMonth: "2027-01",
    movingGoal: 0,
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: 0,
    emergencyTarget: 0,
    emergencyExisting: 0,
    riskFreeRate: 0.02,
    earlyRepaymentPct: 0,
  };
  const lines: BudgetLine[] = [
    { id: "i", category: "income", label: "Salaire", amount: 200000, position: 0 },
    { id: "f", category: "fixed", label: "Loyer", amount: 80000, position: 0 },
  ];
  const state: BudgetFormState = initialFormState(settings, lines, "2027-01");

  it("keeps the regular-month KPIs and feeds the exceptions to the plan", () => {
    const without = computePreview(state, []);
    const withEx = computePreview(state, [], [ex("bonus", "2027-01", "income", 50000), ex("trip", "2027-02", "expense", 30000)]);
    expect(withEx.margin).toBe(without.margin);
    expect(withEx.income).toBe(without.income);
    expect(without.exceptionMonths).toBe(0);
    expect(withEx.exceptionMonths).toBe(2);
    const m1 = withEx.plan?.months[0];
    const m2 = withEx.plan?.months[1];
    expect(m1?.extraIncome).toBe(50000);
    expect(m1?.available).toBe((without.plan?.months[0]?.available ?? 0) + 50000);
    expect(m2?.extraExpenses).toBe(30000);
  });

  it("ignores out-of-period exceptions in the count", () => {
    expect(computePreview(state, [], [ex("old", "2026-06", "income")]).exceptionMonths).toBe(0);
  });
});
