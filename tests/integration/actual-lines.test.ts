/**
 * Check-in rows (issue #72) against the local database: saved with the check-in in one transaction,
 * a copy of each line's label and budget that survives budget changes, re-saving replaces them,
 * and another user's lines cannot be referenced. Fake data, throwaway users. Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { type ActualLine, checkInRows } from "@/lib/domain/actual-lines";
import type { BudgetSettings, MonthlyActualDraft } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 400000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("lines-a"), createTestUser("lines-b")]);
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, [
    { category: "income", label: "Salaire", amount: 280000, position: 0, startMonth: null, endMonth: null },
    { category: "fixed", label: "Loyer", amount: 85000, position: 0, startMonth: null, endMonth: null },
    { category: "variable", label: "Courses", amount: 40000, position: 0, startMonth: null, endMonth: null },
  ]);
  await repo.addException({ month: "2027-03", kind: "expense", label: "Vacances", amount: 90000 });
});
afterAll(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

/** The check-in of `month` with every row filled from `actuals` (by label), 0 otherwise. */
async function draftFor(month: string, actuals: Record<string, number>): Promise<MonthlyActualDraft> {
  const snap = await repo.load();
  const lines: ActualLine[] = checkInRows(snap.lines, snap.exceptions, snap.settings!, month).map((row) => ({
    kind: row.kind,
    direction: row.direction,
    category: row.category,
    budgetLineId: row.budgetLineId,
    exceptionId: row.exceptionId,
    label: row.label,
    planned: row.planned,
    actual: actuals[row.label] ?? 0,
  }));
  const income = lines.filter((l) => l.direction === "income").reduce((s, l) => s + l.actual, 0);
  const expenses = lines.filter((l) => l.direction === "expense").reduce((s, l) => s + l.actual, 0);
  return { month, income, expenses, emergencySavings: 0, freeSavings: 0, loanBalances: [], goalBalances: [], lines, frozen: null };
}

describe("check-in rows", () => {
  it("saves every row with the check-in and reads them back in order", async () => {
    await repo.saveActual(await draftFor("2027-03", { Salaire: 285000, Loyer: 85000, Courses: 46000, Vacances: 88000 }));
    const [saved] = (await repo.load()).actuals;
    expect(saved).toMatchObject({ month: "2027-03", income: 285000, expenses: 219000 });
    expect(saved!.lines.map((l) => [l.kind, l.label, l.planned, l.actual])).toEqual([
      ["line", "Salaire", 280000, 285000],
      ["other", "Autres revenus (hors budget)", 0, 0],
      ["line", "Loyer", 85000, 85000],
      ["line", "Courses", 40000, 46000],
      ["exception", "Vacances", 90000, 88000],
      ["other", "Autres dépenses (hors budget)", 0, 0],
    ]);
  });

  it("keeps the copy when the budget line is renamed, re-priced or deleted, and the exception deleted", async () => {
    const snap = await repo.load();
    const food = snap.lines.find((l) => l.label === "Courses")!;
    const rent = snap.lines.find((l) => l.label === "Loyer")!;
    await repo.saveBudget(
      settings,
      snap.lines.filter((l) => l.id !== rent.id).map((l) => (l.id === food.id ? { ...l, label: "Alimentation", amount: 45000 } : l)),
    );
    await repo.deleteException(snap.exceptions[0]!.id);
    const lines = (await repo.load()).actuals[0]!.lines;
    expect(lines.find((l) => l.budgetLineId === food.id)).toMatchObject({ label: "Courses", planned: 40000, actual: 46000 });
    expect(lines.find((l) => l.label === "Loyer")).toMatchObject({ budgetLineId: null, planned: 85000, actual: 85000 });
    expect(lines.find((l) => l.label === "Vacances")).toMatchObject({ exceptionId: null, planned: 90000, actual: 88000 });
  });

  it("re-saving the month replaces its rows", async () => {
    await repo.saveActual(await draftFor("2027-03", { Salaire: 280000, Alimentation: 41000 }));
    const lines = (await repo.load()).actuals[0]!.lines;
    expect(lines.map((l) => l.label)).toEqual(["Salaire", "Autres revenus (hors budget)", "Alimentation", "Autres dépenses (hors budget)"]);
  });

  it("writes nothing when a row after valid ones is refused", async () => {
    const before = await repo.load();
    const draft = await draftFor("2027-03", { Salaire: 1, Alimentation: 1 });
    draft.lines.push({ kind: "other", direction: "expense", category: null, budgetLineId: null, exceptionId: null, label: "", planned: 0, actual: 1 });
    await expect(repo.saveActual(draft)).rejects.toMatchObject({ code: "23514" });
    expect(await repo.load()).toEqual(before);
  });

  it("another user can neither see these rows nor point at the first user's lines", async () => {
    const other = new SupabaseFinanceRepository(b.client);
    await other.saveBudget(settings, []);
    const salary = (await repo.load()).lines.find((l) => l.label === "Salaire")!;
    const forged = await draftFor("2027-04", {});
    forged.lines = [{ ...forged.lines[0]!, budgetLineId: salary.id }];
    await expect(other.saveActual(forged)).rejects.toMatchObject({ code: "23503" });
    expect((await other.load()).actuals).toEqual([]);
  });
});
