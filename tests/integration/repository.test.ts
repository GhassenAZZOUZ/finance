/** SupabaseFinanceRepository against the local database (fake data, throwaway user). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { BudgetSettings } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let user: TestUser;
let repo: SupabaseFinanceRepository;

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 400000,
  emergencyExisting: 80000, freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
  expenseInflationRate: 0.021,
  incomeGrowthRate: -0.015,
  emergencyRate: 0.024,
  freeSavingsRate: 0.03,
};

beforeAll(async () => {
  user = await createTestUser("repo");
  repo = new SupabaseFinanceRepository(user.client);
});
afterAll(() => deleteTestUser(user));

describe("SupabaseFinanceRepository", () => {
  it("starts with no settings and the 15 default lines (onboarding state)", async () => {
    const snap = await repo.load();
    expect(snap.settings).toBeNull();
    expect(snap.lines).toHaveLength(15);
    expect(snap.loans).toEqual([]);
  });

  it("saves the budget: settings round-trip, lines updated, added and removed", async () => {
    const { lines } = await repo.load();
    const salary = lines.find((l) => l.category === "income" && l.position === 0)!;
    await repo.saveBudget(settings, [
      { id: salary.id, category: "income", label: "Salaire", amount: 280000, position: 0, startMonth: null, endMonth: null },
      { category: "fixed", label: "Loyer", amount: 85000, position: 0, startMonth: "2027-02", endMonth: "2027-06" },
      { category: "variable", label: "Courses", amount: 35012, position: 0, startMonth: null, endMonth: null, indexed: false },
    ]);
    const snap = await repo.load();
    expect(snap.settings).toEqual(settings);
    // Lines are ordered by position within a category; the order across categories is not specified.
    expect(snap.lines.map((l) => [l.category, l.label, l.amount]).sort()).toEqual([
      ["fixed", "Loyer", 85000],
      ["income", "Salaire", 280000],
      ["variable", "Courses", 35012],
    ]);
    expect(snap.lines.find((l) => l.label === "Salaire")?.id).toBe(salary.id);
    expect(snap.lines.find((l) => l.label === "Loyer")).toMatchObject({ startMonth: "2027-02", endMonth: "2027-06" });
    // « Non indexé » (SPEC D27): only the flagged line carries `indexed: false`.
    expect(snap.lines.find((l) => l.label === "Courses")?.indexed).toBe(false);
    expect(snap.lines.find((l) => l.label === "Loyer")?.indexed).toBeUndefined();
  });

  it("records, replaces and clears income payment dates; they follow their line (SPEC D29)", async () => {
    const salary = (await repo.load()).lines.find((l) => l.category === "income")!;
    await repo.setIncomePayment("2027-03", salary.id, "2027-02-26");
    await repo.setIncomePayment("2027-03", salary.id, "2027-02-25");
    await repo.setIncomePayment("2027-04", salary.id, "2027-03-27");
    expect((await repo.load()).incomePayments).toEqual([
      { month: "2027-03", budgetLineId: salary.id, paidOn: "2027-02-25" },
      { month: "2027-04", budgetLineId: salary.id, paidOn: "2027-03-27" },
    ]);
    await repo.setIncomePayment("2027-03", salary.id, null);
    expect((await repo.load()).incomePayments.map((p) => p.month)).toEqual(["2027-04"]);
    // Out of [1st of the month before, end of the month]: refused by the database too.
    await expect(repo.setIncomePayment("2027-05", salary.id, "2027-03-31")).rejects.toThrow();

    // The usual payday round-trips; deleting the line deletes its dates.
    const { lines } = await repo.load();
    await repo.saveBudget(
      settings,
      lines.map((l) => (l.id === salary.id ? { ...l, paydayDay: 27, paydayPreviousMonth: true } : l)),
    );
    expect((await repo.load()).lines.find((l) => l.id === salary.id)).toMatchObject({ paydayDay: 27, paydayPreviousMonth: true });
    await repo.saveBudget(settings, lines.filter((l) => l.id !== salary.id));
    expect((await repo.load()).incomePayments).toEqual([]);
  });

  it("adds, lists (by month) and deletes one-off exceptions", async () => {
    const late = await repo.addException({ month: "2027-08", kind: "expense", label: " Vacances ", amount: 90000 });
    const early = await repo.addException({ month: "2027-03", kind: "income", label: "Prime", amount: 100050 });
    let snap = await repo.load();
    expect(snap.exceptions.map((e) => [e.month, e.kind, e.label, e.amount])).toEqual([
      ["2027-03", "income", "Prime", 100050],
      ["2027-08", "expense", "Vacances", 90000],
    ]);
    await repo.deleteException(early.id);
    await expect(repo.deleteException(early.id)).rejects.toMatchObject({ code: "not_found" });
    snap = await repo.load();
    expect(snap.exceptions.map((e) => e.id)).toEqual([late.id]);
    await repo.deleteException(late.id);
  });

  it("creates, updates and orders loans; exact cents and rates survive the round-trip", async () => {
    const a = await repo.createLoan({ name: "Prêt auto", type: "Prêt affecté", principal: 820000, principalPaidThroughMonth: "2026-09", apr: 0.049, monthlyPayment: 24530, contractEndMonth: "2030-01", penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null });
    const b = await repo.createLoan({ name: null, type: "Dette personnelle", principal: 60000, principalPaidThroughMonth: null, apr: 0, monthlyPayment: 15000, contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null });
    await repo.updateLoan(a.id, { name: "Prêt auto", type: "Prêt affecté", principal: 810001, principalPaidThroughMonth: "2026-10", apr: 0.0615, monthlyPayment: 24530, contractEndMonth: "2029-12", penaltyPct: 0.03, penaltyCapMonths: 6, kind: "loan", creditLimit: null });
    const { loans } = await repo.load();
    expect(loans.map((l) => [l.id, l.principal, l.principalPaidThroughMonth, l.apr, l.contractEndMonth, l.penaltyPct, l.penaltyCapMonths, l.position])).toEqual([
      [a.id, 810001, "2026-10", 0.0615, "2029-12", 0.03, 6, 0],
      [b.id, 60000, null, 0, null, null, null, 1],
    ]);
  });

  it("saves one check-in per month (re-saving replaces it) and archives loans that have history", async () => {
    const { loans } = await repo.load();
    const [a, b] = loans;
    const draft = {
      month: "2027-01",
      income: null,
      expenses: 172500,
      emergencySavings: 80000,
      freeSavings: 0,
      loanBalances: [
        { loanId: a!.id, balance: 798818 },
        { loanId: b!.id, balance: 45000 },
      ],
      goalBalances: [],
      frozen: null,
    };
    await repo.saveActual(draft);
    await repo.saveActual({ ...draft, freeSavings: 1234, loanBalances: [{ loanId: a!.id, balance: 700000 }, { loanId: b!.id, balance: 0 }] });
    let snap = await repo.load();
    expect(snap.actuals).toHaveLength(1);
    expect(snap.actuals[0]).toMatchObject({ month: "2027-01", income: null, expenses: 172500, freeSavings: 1234 });
    expect(snap.actuals[0]!.loanBalances.map((x) => x.balance).sort()).toEqual([0, 700000]);

    expect(await repo.removeLoan(b!.id)).toBe("archived");
    const c = await repo.createLoan({ name: "Sans historique", type: null, principal: 1000, principalPaidThroughMonth: null, apr: 0.1, monthlyPayment: 100, contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null });
    expect(await repo.removeLoan(c.id)).toBe("deleted");
    snap = await repo.load();
    expect(snap.loans.map((l) => l.id)).toEqual([a!.id]);
    expect(snap.archivedLoans.map((l) => l.id)).toEqual([b!.id]);

    await expect(repo.removeLoan(c.id)).rejects.toMatchObject({ code: "not_found" });

    // Freezing never overwrites values already frozen (SPEC D16).
    const frozen = { plannedDebt: 800000, plannedSavings: 174355, plannedIncome: 290000, plannedExpenses: 172500, planStartMonth: "2027-01" };
    await repo.freezeActuals([{ month: "2027-01", frozen }]);
    await repo.freezeActuals([{ month: "2027-01", frozen: { ...frozen, plannedDebt: 1 } }]);
    expect((await repo.load()).actuals[0]!.frozen).toEqual(frozen);
    await repo.saveSettings({ ...settings, freeSavingsExisting: 12345 });
    expect((await repo.load()).settings?.freeSavingsExisting).toBe(12345);

    await repo.deleteActual("2027-01");
    expect((await repo.load()).actuals).toEqual([]);
  });
});
