/** Bank import rules and per-line totals (issue #63, SPEC D31). Invented data only. */
import { describe, expect, it } from "vitest";
import { type BankRule, keywordOf, learnRules, lineTotals, matchRule, normalizeLabel } from "@/lib/import/bank-rules";

const tx = (label: string, amount: number) => ({ line: 2, date: "2026-09-01", label, amount });
const rule = (keyword: string, budgetLineId: string | null): BankRule => ({ id: keyword, keyword, budgetLineId });

describe("keywords", () => {
  it("normalises labels and keeps their first two words", () => {
    expect(normalizeLabel("Carrefour Market 1234 — Paris 15e")).toBe("CARREFOUR MARKET PARIS E");
    expect(keywordOf("CB CARREFOUR 12/09")).toBe("CARREFOUR");
    // Revolut's generic prefixes are skipped: one keyword per counterparty (invented names).
    expect(keywordOf("Paiement envoyé par EXEMPLE EMPLOI SAS")).toBe("EXEMPLE EMPLOI");
    expect(keywordOf("Virement de : Jean Exemple")).toBe("JEAN EXEMPLE");
    expect(keywordOf("To Jean Exemple")).toBe("JEAN EXEMPLE");
    expect(keywordOf("Virement")).toBe("VIREMENT");
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
      { keyword: "LIVRET", budgetLineId: null },
    ]);
  });
});

describe("AC-02 — per-line totals and « Réel vs budget »", () => {
  const categories: Record<string, "income" | "fixed" | "variable"> = { salary: "income", rent: "fixed", food: "variable" };
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
});
