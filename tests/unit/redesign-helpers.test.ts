/** UI helpers added by the redesign (docs/design): pending check-ins, provisional status, loan order. */
import { describe, expect, it } from "vitest";
import { type LoanRow, payoffGain, sortByPriority, timelinePosition, timelineScale } from "@/app/(app)/credits/loan-view";
import {
  type PlannedValues,
  parseMonthParam,
  pendingCheckIns,
  pendingMonthsText,
  provisionalCheck,
} from "@/app/(app)/suivi/logic";
import type { ActualForm } from "@/lib/domain/validation";

describe("pendingCheckIns", () => {
  it("lists the open months without a check-in, oldest first, the current month included", () => {
    expect(pendingCheckIns("2026-07", "2026-09", ["2026-07"])).toEqual(["2026-08", "2026-09"]);
    expect(pendingCheckIns("2026-07", "2026-09", ["2026-07", "2026-08", "2026-09"])).toEqual([]);
  });

  it("is empty before the plan starts", () => {
    expect(pendingCheckIns("2026-10", "2026-09", [])).toEqual([]);
  });
});

describe("pendingMonthsText", () => {
  it("names the months in words", () => {
    expect(pendingMonthsText(["2026-08"])).toBe("août 2026");
    expect(pendingMonthsText(["2026-08", "2026-09"])).toBe("août et septembre 2026");
    expect(pendingMonthsText(["2026-07", "2026-08", "2026-09"])).toBe("juillet, août et septembre 2026");
    expect(pendingMonthsText(["2026-12", "2027-01"])).toBe("décembre 2026 et janvier 2027");
  });

  it("shows a range beyond three months", () => {
    expect(pendingMonthsText(["2026-01", "2026-02", "2026-03", "2026-04"])).toBe("janv. 2026 → avr. 2026");
    expect(pendingMonthsText([])).toBe("");
  });
});

describe("parseMonthParam", () => {
  it("accepts only an open month", () => {
    expect(parseMonthParam("2026-08", ["2026-09", "2026-08"])).toBe("2026-08");
    expect(parseMonthParam("2026-05", ["2026-09", "2026-08"])).toBeNull();
    expect(parseMonthParam(null, ["2026-09"])).toBeNull();
  });
});

describe("provisionalCheck", () => {
  const planned: PlannedValues = {
    movingSavings: 138_710,
    emergencySavings: 80_000,
    freeSavings: 0,
    income: 290_000,
    expenses: 172_500,
    loanBalances: [319_684, 176_280],
  };
  const form = (over: Partial<ActualForm> = {}): ActualForm => ({
    month: "2026-08",
    income: "",
    expenses: "",
    movingSavings: "1 387,10",
    emergencySavings: "800",
    freeSavings: "0",
    loanBalances: [
      { loanId: "a", balance: "3 210,00" },
      { loanId: "b", balance: "1 762,80" },
    ],
    ...over,
  });

  it("applies the engine rule once every balance is typed", () => {
    // Debts +13,16 € (over the 10 € tolerance), savings on plan: mixed.
    expect(provisionalCheck(form(), planned)).toEqual({ missing: 0, debtGap: 1_316, savingsGap: 0, status: "mixed" });
  });

  it("counts the missing balances and waits for them", () => {
    const check = provisionalCheck(form({ loanBalances: [{ loanId: "a", balance: "" }, { loanId: "b", balance: "x" }] }), planned);
    expect(check).toEqual({ missing: 2, debtGap: null, savingsGap: 0, status: null });
  });

  it("has no gaps outside the plan", () => {
    expect(provisionalCheck(form(), null)).toEqual({ missing: 0, debtGap: null, savingsGap: null, status: null });
  });
});

describe("credits: order and timelines", () => {
  const row = (id: string, apr: number, priority: number | null, withPlan: string | null, without: string | null) =>
    ({
      id,
      apr,
      derived: { priority, eligible: priority !== null, payoffMonthWithPlan: withPlan, payoffMonthWithoutPlan: without },
    }) as unknown as LoanRow;

  it("puts eligible loans first by priority, then the others by APR", () => {
    const rows = [row("low", 0.012, null, null, null), row("p2", 0.06, 2, null, null), row("zero", 0, null, null, null), row("p1", 0.19, 1, null, null)];
    expect(sortByPriority(rows).map((r) => r.id)).toEqual(["p1", "p2", "low", "zero"]);
  });

  it("measures the months saved and places months on a shared axis", () => {
    expect(payoffGain({ payoffMonthWithPlan: "2027-08", payoffMonthWithoutPlan: "2029-03" })).toBe(19);
    expect(payoffGain({ payoffMonthWithPlan: "2027-08", payoffMonthWithoutPlan: null })).toBeNull();
    const scale = timelineScale([row("a", 0.1, 1, "2027-08", "2029-03")], "2026-07");
    expect(scale).toEqual({ start: "2026-07", months: 34 });
    expect(timelinePosition(scale, "2026-07")).toBeCloseTo(0.5 / 34);
    expect(timelinePosition(scale, "2040-01")).toBe(1);
  });
});
