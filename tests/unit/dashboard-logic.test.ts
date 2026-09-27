/** Dashboard helpers: chart series in euros, text alternatives, latest-actuals gap tones (SPEC §7, §8). */
import { describe, expect, it } from "vitest";
import {
  debtGapTone,
  debtSavingsSeries,
  debtSavingsSummary,
  formatSignedEuros,
  fundsSeries,
  fundsSummary,
  savingsGapTone,
} from "@/app/(app)/_dashboard/logic";
import { type PlanInput, simulatePlan } from "@/lib/engine";
import { formatEuros } from "@/lib/format";

const input: PlanInput = {
  budget: {
    income: 250000,
    fixedCosts: 100000,
    variableExpenses: 50000,
    startMonth: "2027-01",
    movingGoal: 300000,
    movingDeadlineMonth: "2027-06",
    movingAlreadySaved: 0,
    emergencyTarget: 200000,
    emergencyExisting: 0, freeSavingsExisting: 0,
    riskFreeRate: 0.024,
    earlyRepaymentPct: 0.5,
  },
  loans: [{ id: "a", name: null, principal: 500000, apr: 0.12, monthlyPayment: 20000 }],
};
const { months, kpis } = simulatePlan(input);

describe("debtSavingsSeries", () => {
  it("takes the first 24 months and converts cents to euros", () => {
    const series = debtSavingsSeries(months);
    expect(series).toHaveLength(24);
    expect(series[0]).toEqual({
      month: "2027-01",
      label: "janv. 2027",
      debt: months[0]!.remainingDebt / 100,
      freeSavings: months[0]!.freeSavingsCumulative / 100,
    });
    expect(series[23]!.month).toBe("2028-12");
  });
});

describe("fundsSeries", () => {
  it("takes 12 months with constant targets in euros", () => {
    const series = fundsSeries(months, kpis.movingGoal, kpis.emergencyTarget);
    expect(series).toHaveLength(12);
    expect(series.every((p) => p.movingGoal === 3000 && p.emergencyTarget === 2000)).toBe(true);
    expect(series[11]!.moving).toBe(months[11]!.movingCumulative / 100);
    expect(series[11]!.emergency).toBe(months[11]!.emergencyCumulative / 100);
  });
});

describe("chart summaries", () => {
  it("describe the first and last values of each series", () => {
    const a = debtSavingsSummary(months);
    expect(a).toContain("24 mois");
    expect(a).toContain("janvier 2027");
    expect(a).toContain("décembre 2028");
    const b = fundsSummary(months, kpis.movingGoal, kpis.emergencyTarget);
    expect(b).toContain("12 mois");
    expect(b).toMatch(/objectif 3\s000\s€/);
  });

  it("handle an empty plan", () => {
    expect(debtSavingsSummary([])).toBe("Aucune donnée.");
    expect(fundsSummary([], 0, 0)).toBe("Aucune donnée.");
  });
});

describe("gap tones (inclusive ±10 € boundaries)", () => {
  it.each([
    [-5000, "good"],
    [1000, "good"],
    [1001, "bad"],
    [null, null],
  ] as const)("debt gap %s → %s", (gap, tone) => {
    expect(debtGapTone(gap)).toBe(tone);
  });

  it.each([
    [5000, "good"],
    [-1000, "good"],
    [-1001, "bad"],
    [null, null],
  ] as const)("savings gap %s → %s", (gap, tone) => {
    expect(savingsGapTone(gap)).toBe(tone);
  });
});

describe("formatSignedEuros", () => {
  it("prefixes positive amounts with +", () => {
    expect(formatSignedEuros(1234)).toBe(`+${formatEuros(1234)}`);
    expect(formatSignedEuros(0)).toBe(formatEuros(0));
    expect(formatSignedEuros(-350)).toBe(formatEuros(-350));
  });
});
