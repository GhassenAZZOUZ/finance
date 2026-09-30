/** Bank import rules and per-line totals (issue #63, SPEC D31). Invented data only. */
import { describe, expect, it } from "vitest";
import type { BudgetLine } from "@/lib/domain/types";
import { type BankRule, keywordOf, learnRules, lineTotals, lineVsBudget, matchRule, normalizeLabel } from "@/lib/import/bank-rules";

const tx = (label: string, amount: number) => ({ line: 2, date: "2026-09-01", label, amount });
const rule = (keyword: string, budgetLineId: string | null): BankRule => ({ id: keyword, keyword, budgetLineId });

describe("keywords", () => {
  it("normalises labels and keeps their first two words", () => {
    expect(normalizeLabel("Carrefour Market 1234 — Paris 15e")).toBe("CARREFOUR MARKET PARIS E");
    expect(keywordOf("CB CARREFOUR 12/09")).toBe("CB CARREFOUR");
    expect(keywordOf("Supermarché Exemple")).toBe("SUPERMARCHE EXEMPLE");
    expect(keywordOf("1234 5678")).toBe("");
  });
});

describe("AC-01 — rules propose assignments", () => {
  it("matches a keyword inside the label, the longest one first", () => {
    const rules = [rule("CARREFOUR", "food"), rule("CARREFOUR MARKET", "snacks"), rule("LOYER", "rent")];
    expect(matchRule("CARREFOUR MARKET 1234", rules)?.budgetLineId).toBe("snacks");
    expect(matchRule("Carrefour City", rules)?.budgetLineId).toBe("food");
    expect(matchRule("CARREFOURS", rules)).toBeUndefined();
    expect(matchRule("Boulangerie", rules)).toBeUndefined();
  });

  it("learns one rule per keyword, ignored ones included, the last assignment winning", () => {
    expect(
      learnRules([tx("CARREFOUR 1", -10), tx("Virement Livret A", -500), tx("CARREFOUR 2", -20)], ["food", null, "snacks"]),
    ).toEqual([
      { keyword: "CARREFOUR", budgetLineId: "snacks" },
      { keyword: "VIREMENT LIVRET", budgetLineId: null },
    ]);
  });
});

describe("AC-02 — per-line totals and « Réel vs budget »", () => {
  const categories: Record<string, "income" | "fixed" | "variable"> = { salary: "income", rent: "fixed", food: "variable" };
  const line = (id: string, category: BudgetLine["category"], amount: number, extra: Partial<BudgetLine> = {}): BudgetLine => ({
    id,
    category,
    label: id,
    amount,
    position: 0,
    startMonth: null,
    endMonth: null,
    ...extra,
  });

  it("sums per line: income received, money spent (refunds lower it)", () => {
    const totals = lineTotals(
      [tx("PAY", 260_000), tx("SHOP", -12_340), tx("REFUND", 2_000), tx("RENT", -90_000), tx("TRANSFER", -50_000)],
      ["salary", "food", "food", "rent", null],
      (id) => categories[id],
    );
    expect(totals).toEqual([
      { budgetLineId: "salary", actual: 260_000 },
      { budgetLineId: "food", actual: 10_340 },
      { budgetLineId: "rent", actual: 90_000 },
    ]);
  });

  it("compares with the month's budget and flags overspending and missing income", () => {
    const lines = [
      line("salary", "income", 280_000),
      line("rent", "fixed", 90_000),
      line("food", "variable", 40_000),
      line("gym", "variable", 3_000, { endMonth: "2026-06" }),
    ];
    const rows = lineVsBudget(lines, { startMonth: "2026-01" }, "2026-09", [
      { month: "2026-09", budgetLineId: "salary", actual: 260_000 },
      { month: "2026-09", budgetLineId: "food", actual: 45_000 },
      { month: "2026-09", budgetLineId: "rent", actual: 90_000 },
      { month: "2026-08", budgetLineId: "rent", actual: 1 },
    ]);
    expect(rows.map((r) => [r.line.id, r.budget, r.actual, r.gap, r.off])).toEqual([
      ["salary", 280_000, 260_000, -20_000, true],
      ["rent", 90_000, 90_000, 0, false],
      ["food", 40_000, 45_000, 5_000, true],
    ]);
  });

  it("uses the indexed budget of that month (D27)", () => {
    const rows = lineVsBudget([line("rent", "fixed", 100_000)], { startMonth: "2026-01", expenseInflationRate: 0.02 }, "2027-03", [
      { month: "2027-03", budgetLineId: "rent", actual: 102_000 },
    ]);
    expect(rows[0]).toMatchObject({ budget: 102_000, gap: 0, off: false });
  });
});
