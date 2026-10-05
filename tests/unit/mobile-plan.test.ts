/** Mobile Plan helpers (issue #113): phase labels per year, short names, identical months. */
import { describe, expect, it } from "vitest";
import { groupIdentical, shortName, yearPhaseLabel } from "@/app/(app)/plan/mobile-plan-logic";
import type { PlanPhase } from "@/app/(app)/_dashboard/logic";
import type { PlanMonth } from "@/lib/engine";

const month = (index: number, ym: string, over: Partial<PlanMonth> = {}): PlanMonth =>
  ({
    index,
    month: ym,
    available: 50_000,
    toMoving: 0,
    toEmergency: 0,
    toEarlyRepayment: 25_000,
    unusedEarlyRepayment: 0,
    toFreeSavings: 25_000,
    ...over,
  }) as PlanMonth;

const phase = (kind: PlanPhase["kind"], startIndex: number, endIndex: number): PlanPhase => ({
  kind,
  startIndex,
  endIndex,
  startMonth: "2026-01",
  endMonth: "2026-01",
});

describe("yearPhaseLabel", () => {
  it("names one phase, capitalised", () => {
    expect(yearPhaseLabel([month(1, "2026-09")], [phase("moving", 1, 4)], "Déménagement", 0.5)).toBe("① Déménagement");
  });

  it("chains the phases met in the year", () => {
    const months = [month(1, "2027-01"), month(2, "2027-02"), month(3, "2027-03")];
    const phases = [phase("emergency", 1, 2), phase("repay", 3, 10)];
    expect(yearPhaseLabel(months, phases, "Voyage", 0.5)).toBe("② Urgence, puis ③ remboursement");
    expect(yearPhaseLabel(months, phases, "Voyage", 0)).toBe("② Urgence, puis ③ épargne");
  });
});

describe("shortName", () => {
  it("abbreviates long goal names only", () => {
    expect(shortName("Déménagement")).toBe("Déménag.");
    expect(shortName("Voyage")).toBe("Voyage");
  });
});

describe("groupIdentical", () => {
  const none = () => false;

  it("folds following months with the same amounts", () => {
    const groups = groupIdentical([month(1, "2027-01"), month(2, "2027-02"), month(3, "2027-03")], none);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.same.map((m) => m.month)).toEqual(["2027-02", "2027-03"]);
  });

  it("starts a new card on a different allocation, an event, or a new year", () => {
    const months = [
      month(1, "2027-11"),
      month(2, "2027-12", { toFreeSavings: 30_000, available: 55_000 }),
      month(3, "2028-01", { toFreeSavings: 30_000, available: 55_000 }),
      month(4, "2028-02", { toFreeSavings: 30_000, available: 55_000 }),
      month(5, "2028-03", { toFreeSavings: 30_000, available: 55_000 }),
    ];
    const groups = groupIdentical(months, (m) => m.index === 4);
    expect(groups.map((g) => [g.head.month, g.same.map((m) => m.month)])).toEqual([
      ["2027-11", []],
      ["2027-12", []],
      ["2028-01", []],
      ["2028-02", ["2028-03"]],
    ]);
  });
});
