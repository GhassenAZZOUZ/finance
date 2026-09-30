/** « Plan tenu » verdict (issue #74, SPEC D34), with the issue's worked examples. */
import { describe, expect, it } from "vitest";
import type { ActualLine } from "@/lib/domain/actual-lines";
import type { SavingsDeposit } from "@/lib/domain/deposits";
import { isDetailed, verdictOf } from "@/lib/domain/verdict";

const row = (label: string, direction: "income" | "expense", planned: number, actual: number): ActualLine => ({
  kind: "line",
  direction,
  category: direction === "income" ? "income" : "variable",
  budgetLineId: label,
  exceptionId: null,
  label,
  planned,
  actual,
});
const pot = (pot: SavingsDeposit["pot"], planned: number, amount: number, goalName: string | null = null): SavingsDeposit => ({
  pot,
  goalId: goalName ? "g" : null,
  goalName,
  planned,
  amount,
});
/** Plan for 2027-03: income 2 800 €, expenses 1 650 € (rent 1 130, groceries 400, outings 120), deposits 550 €. */
function month(income: number, [rent, groceries, outings]: [number, number, number], [voyage, emergency, free]: [number, number, number]) {
  return {
    lines: [
      row("Salaire", "income", 280_000, income),
      row("Loyer", "expense", 113_000, rent),
      row("Courses", "expense", 40_000, groceries),
      row("Sorties", "expense", 12_000, outings),
    ],
    deposits: [pot("goal", 30_000, voyage, "Voyage"), pot("emergency", 20_000, emergency), pot("free", 5_000, free)],
  };
}

describe("verdict", () => {
  it("AC-01 — all three checks OK → « Plan tenu »", () => {
    const v = verdictOf(month(280_000, [113_000, 35_000, 12_000], [30_000, 20_000, 10_000]))!;
    expect(v.kind).toBe("held");
    expect([v.income.ok, v.expenses.ok, v.savings.ok]).toEqual([true, true, true]);
    expect(v.expenses).toMatchObject({ actual: 160_000, planned: 165_000, gap: -5_000 });
    expect(v.overspent).toEqual([]);
  });

  it("AC-02 — overspending → « Plan partiellement tenu », with the lines concerned", () => {
    const v = verdictOf(month(280_000, [113_000, 48_000, 15_000], [30_000, 20_000, 5_000]))!;
    expect(v.kind).toBe("partial");
    expect(v.expenses).toMatchObject({ actual: 176_000, gap: 11_000, ok: false });
    expect(v.overspent).toEqual([
      { label: "Courses", gap: 8_000 },
      { label: "Sorties", gap: 3_000 },
    ]);
  });

  it("AC-03 — nothing held → « Plan non tenu », with the missed pots", () => {
    const v = verdictOf(month(250_000, [113_000, 55_000, 22_000], [10_000, 0, 0]))!;
    expect(v.kind).toBe("missed");
    expect([v.income.gap, v.expenses.gap, v.savings.gap]).toEqual([-30_000, 25_000, -45_000]);
    expect(v.missedPots.map((p) => p.label)).toEqual(["Voyage", "Fonds d’urgence", "Épargne libre"]);
  });

  it("AC-04 — tolerance of ±10 € on each check", () => {
    const at = (groceries: number) => verdictOf(month(280_000, [113_000, groceries, 12_000], [30_000, 20_000, 5_000]))!.expenses.ok;
    expect(at(41_000)).toBe(true);
    expect(at(41_001)).toBe(false);
    const income = (salary: number) => verdictOf(month(salary, [113_000, 40_000, 12_000], [30_000, 20_000, 5_000]))!.income.ok;
    expect(income(279_000)).toBe(true);
    expect(income(278_999)).toBe(false);
    const saved = (free: number) => verdictOf(month(280_000, [113_000, 40_000, 12_000], [30_000, 20_000, free]))!.savings.ok;
    expect(saved(4_000)).toBe(true);
    expect(saved(3_999)).toBe(false);
  });

  it("counts a withdrawal against the savings check", () => {
    expect(verdictOf(month(280_000, [113_000, 40_000, 12_000], [30_000, 20_000, -20_000]))!.savings).toMatchObject({ actual: 30_000, ok: false });
  });

  it("keeps the largest 3 overspent lines only", () => {
    const m = month(280_000, [120_000, 50_000, 20_000], [30_000, 20_000, 5_000]);
    m.lines.push(row("Essence", "expense", 10_000, 12_000));
    expect(verdictOf(m)!.overspent.map((l) => l.label)).toEqual(["Courses", "Sorties", "Loyer"]);
  });

  it("AC-07 — no verdict without rows or deposits (« non détaillé »)", () => {
    expect(isDetailed({ lines: [] })).toBe(false);
    expect(verdictOf({ lines: month(0, [0, 0, 0], [0, 0, 0]).lines })).toBeNull();
    expect(verdictOf({ lines: [], deposits: [pot("free", 0, 0)] })).toBeNull();
  });
});
