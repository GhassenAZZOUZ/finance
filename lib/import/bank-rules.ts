/**
 * Bank import rules and per-line totals (issue #63, SPEC D31): assignments confirmed in an import
 * become keyword rules proposed next time; each import stores the month's actual total per line.
 */
import { type Cents, type YearMonth, indexationYears, indexedAmount, isLineActive, lineRate } from "@/lib/engine";
import type { BudgetLine, BudgetSettings } from "@/lib/domain/types";
import type { Assignment, BankTransaction } from "./bank-csv";

export interface BankRule {
  id: string;
  /** Normalised label fragment, e.g. « CARREFOUR MARKET ». */
  keyword: string;
  /** Budget line, or null for « Ignoré ». */
  budgetLineId: string | null;
}

export interface BankLineTotal {
  month: YearMonth;
  budgetLineId: string;
  /** Income received, or money spent (refunds lower it). */
  actual: Cents;
}

/** Upper case, no accents, digits or punctuation, single spaces: « Carrefour Market 1234 » → « CARREFOUR MARKET ». */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The keyword a confirmed assignment teaches: the label's first two words (card and transfer references dropped). */
export function keywordOf(label: string): string {
  return normalizeLabel(label).split(" ").filter((w) => w.length > 1).slice(0, 2).join(" ").slice(0, 100);
}

/** The rule matching a label: its keyword is in the label; the longest keyword wins. */
export function matchRule(label: string, rules: readonly BankRule[]): BankRule | undefined {
  const text = ` ${normalizeLabel(label)} `;
  return rules
    .filter((r) => r.keyword !== "" && text.includes(` ${r.keyword} `))
    .sort((a, b) => b.keyword.length - a.keyword.length)[0];
}

/** Rules learnt from an import: one per keyword, the last assignment wins. */
export function learnRules(transactions: readonly BankTransaction[], assignments: readonly Assignment[]): Omit<BankRule, "id">[] {
  const byKeyword = new Map<string, string | null>();
  transactions.forEach((t, i) => {
    const keyword = keywordOf(t.label);
    if (keyword) byKeyword.set(keyword, assignments[i] ?? null);
  });
  return [...byKeyword].map(([keyword, budgetLineId]) => ({ keyword, budgetLineId }));
}

/** Actual total per budget line: income lines add, expense lines count money spent. */
export function lineTotals(
  transactions: readonly BankTransaction[],
  assignments: readonly Assignment[],
  categoryOf: (lineId: string) => "income" | "fixed" | "variable" | undefined,
): { budgetLineId: string; actual: Cents }[] {
  const totals = new Map<string, Cents>();
  transactions.forEach((t, i) => {
    const lineId = assignments[i];
    const category = lineId ? categoryOf(lineId) : undefined;
    if (!lineId || !category) return;
    totals.set(lineId, (totals.get(lineId) ?? 0) + (category === "income" ? t.amount : -t.amount));
  });
  return [...totals].map(([budgetLineId, actual]) => ({ budgetLineId, actual }));
}

export interface LineVsBudget {
  line: BudgetLine;
  /** That month's budget (D15 period, D27 indexation); 0 when the line is not active. */
  budget: Cents;
  actual: Cents;
  /** actual − budget. */
  gap: Cents;
  /** An expense line spent more than its budget, or an income line received less. */
  off: boolean;
}

/** « Réel vs budget » of an imported month (SPEC D31): every line with a budget or an actual total. */
export function lineVsBudget(
  lines: readonly BudgetLine[],
  settings: Pick<BudgetSettings, "startMonth" | "expenseInflationRate" | "incomeGrowthRate">,
  month: YearMonth,
  totals: readonly BankLineTotal[],
): LineVsBudget[] {
  const years = indexationYears(settings.startMonth, month);
  return lines.flatMap((line) => {
    const actual = totals.find((t) => t.month === month && t.budgetLineId === line.id)?.actual ?? 0;
    const budget = isLineActive(line, month) ? indexedAmount(line.amount, lineRate(line, settings), years) : 0;
    if (budget === 0 && actual === 0) return [];
    const gap = actual - budget;
    return [{ line, budget, actual, gap, off: line.category === "income" ? gap < 0 : gap > 0 }];
  });
}
