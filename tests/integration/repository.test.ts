/** SupabaseFinanceRepository against the local database (fake data, throwaway user). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { BudgetSettings } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let user: TestUser;
let repo: SupabaseFinanceRepository;

const settings: BudgetSettings = {
  startMonth: "2027-01",
  movingGoal: 400000,
  movingDeadlineMonth: "2027-06",
  movingAlreadySaved: 50000,
  emergencyTarget: 400000,
  emergencyExisting: 80000,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
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
      { id: salary.id, category: "income", label: "Salaire", amount: 280000, position: 0 },
      { category: "fixed", label: "Loyer", amount: 85000, position: 0 },
      { category: "variable", label: "Courses", amount: 35012, position: 0 },
    ]);
    const snap = await repo.load();
    expect(snap.settings).toEqual(settings);
    expect(snap.lines.map((l) => [l.category, l.label, l.amount])).toEqual([
      ["income", "Salaire", 280000],
      ["fixed", "Loyer", 85000],
      ["variable", "Courses", 35012],
    ]);
    expect(snap.lines.find((l) => l.label === "Salaire")?.id).toBe(salary.id);
  });

  it("creates, updates and orders loans; exact cents and rates survive the round-trip", async () => {
    const a = await repo.createLoan({ name: "Prêt auto", type: "Prêt affecté", principal: 820000, apr: 0.049, monthlyPayment: 24530 });
    const b = await repo.createLoan({ name: null, type: "Dette personnelle", principal: 60000, apr: 0, monthlyPayment: 15000 });
    await repo.updateLoan(a.id, { name: "Prêt auto", type: "Prêt affecté", principal: 810001, apr: 0.0615, monthlyPayment: 24530 });
    const { loans } = await repo.load();
    expect(loans.map((l) => [l.id, l.principal, l.apr, l.position])).toEqual([
      [a.id, 810001, 0.0615, 0],
      [b.id, 60000, 0, 1],
    ]);
  });

  it("saves one check-in per month (re-saving replaces it) and archives loans that have history", async () => {
    const { loans } = await repo.load();
    const [a, b] = loans;
    const draft = {
      month: "2027-01",
      income: null,
      expenses: 172500,
      movingSavings: 94355,
      emergencySavings: 80000,
      freeSavings: 0,
      loanBalances: [
        { loanId: a!.id, balance: 798818 },
        { loanId: b!.id, balance: 45000 },
      ],
    };
    await repo.saveActual(draft);
    await repo.saveActual({ ...draft, freeSavings: 1234, loanBalances: [{ loanId: a!.id, balance: 700000 }, { loanId: b!.id, balance: 0 }] });
    let snap = await repo.load();
    expect(snap.actuals).toHaveLength(1);
    expect(snap.actuals[0]).toMatchObject({ month: "2027-01", income: null, expenses: 172500, freeSavings: 1234 });
    expect(snap.actuals[0]!.loanBalances.map((x) => x.balance).sort()).toEqual([0, 700000]);

    expect(await repo.removeLoan(b!.id)).toBe("archived");
    const c = await repo.createLoan({ name: "Sans historique", type: null, principal: 1000, apr: 0.1, monthlyPayment: 100 });
    expect(await repo.removeLoan(c.id)).toBe("deleted");
    snap = await repo.load();
    expect(snap.loans.map((l) => l.id)).toEqual([a!.id]);
    expect(snap.archivedLoans.map((l) => l.id)).toEqual([b!.id]);

    await expect(repo.removeLoan(c.id)).rejects.toMatchObject({ code: "not_found" });

    await repo.deleteActual("2027-01");
    expect((await repo.load()).actuals).toEqual([]);
  });
});
