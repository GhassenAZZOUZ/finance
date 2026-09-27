import { describe, expect, it } from "vitest";
import { exceptionsByPlanIndex } from "@/app/(app)/plan/exceptions";
import type { BudgetException } from "@/lib/domain/types";

const exc = (id: string, month: string, kind: BudgetException["kind"], label: string, amount: number): BudgetException => ({
  id,
  month,
  kind,
  label,
  amount,
});

describe("exceptionsByPlanIndex", () => {
  it("maps each exception to its 1-based plan month, split by kind", () => {
    const map = exceptionsByPlanIndex(
      [exc("a", "2027-01", "income", "Prime", 100_000), exc("b", "2027-03", "expense", "Vacances", 150_000)],
      "2027-01",
      300,
    );
    expect([...map.keys()].sort((x, y) => x - y)).toEqual([1, 3]);
    expect(map.get(1)).toEqual({ income: [{ id: "a", label: "Prime", amount: 100_000 }], expense: [] });
    expect(map.get(3)).toEqual({ income: [], expense: [{ id: "b", label: "Vacances", amount: 150_000 }] });
    expect(map.get(2)).toBeUndefined();
  });

  it("groups several exceptions of the same month, keeping input order", () => {
    const map = exceptionsByPlanIndex(
      [
        exc("a", "2027-06", "income", "Prime", 100_000),
        exc("b", "2027-06", "expense", "Garage", 40_000),
        exc("c", "2027-06", "income", "Cadeau", 20_000),
      ],
      "2027-01",
      300,
    );
    expect(map.size).toBe(1);
    const june = map.get(6)!;
    expect(june.income.map((e) => e.label)).toEqual(["Prime", "Cadeau"]);
    expect(june.expense.map((e) => e.label)).toEqual(["Garage"]);
  });

  it("ignores exceptions outside the plan (before the start or after the last month)", () => {
    const map = exceptionsByPlanIndex(
      [
        exc("before", "2026-12", "income", "Avant", 1),
        exc("first", "2027-01", "income", "Premier", 2),
        exc("last", "2051-12", "expense", "Dernier", 3),
        exc("after", "2052-01", "expense", "Après", 4),
      ],
      "2027-01",
      300,
    );
    expect([...map.keys()].sort((x, y) => x - y)).toEqual([1, 300]);
    expect(map.get(1)!.income.map((e) => e.id)).toEqual(["first"]);
    expect(map.get(300)!.expense.map((e) => e.id)).toEqual(["last"]);
  });

  it("returns an empty map without exceptions", () => {
    expect(exceptionsByPlanIndex([], "2027-01", 300).size).toBe(0);
  });
});
