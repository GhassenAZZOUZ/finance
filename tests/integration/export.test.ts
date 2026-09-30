/** The JSON backup (issue #7) of user A contains none of user B's rows. Requires `supabase start`. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { BudgetSettings } from "@/lib/domain/types";
import { buildBackup, serializeBackup } from "@/lib/export/backup";
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

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("export-a"), createTestUser("export-b")]);
  for (const [user, tag] of [
    [a, "AAA"],
    [b, "BBB"],
  ] as const) {
    const repo = new SupabaseFinanceRepository(user.client);
    await repo.saveBudget(settings, [
      { category: "income", label: `Salaire ${tag}`, amount: 250000, position: 0, startMonth: null, endMonth: null },
    ]);
    await repo.addException({ month: "2027-03", kind: "income", label: `Prime ${tag}`, amount: 10000 });
    const goal = await repo.createGoal({ name: `Objectif ${tag}`, target: 400000, deadlineMonth: "2027-06", alreadySaved: 0 }, 1);
    const loan = await repo.createLoan({
      name: `Prêt ${tag}`,
      type: null,
      principal: 500000,
      principalPaidThroughMonth: null,
      apr: 0.05,
      monthlyPayment: 20000,
      contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null,
    });
    await repo.saveActual({
      month: "2027-01",
      income: null,
      expenses: null,
      emergencySavings: 0,
      freeSavings: 0,
      loanBalances: [{ loanId: loan.id, balance: 490000 }],
      goalBalances: [{ goalId: goal.id, balance: 12300 }],
      lines: [],
      frozen: null,
    });
  }
});
afterAll(async () => {
  await Promise.all([deleteTestUser(a), deleteTestUser(b)]);
});

describe("JSON backup", () => {
  it("contains all of A's collections and nothing of B's", async () => {
    const backup = buildBackup(await new SupabaseFinanceRepository(a.client).load());
    expect(backup.data.budgetLines.map((l) => l.label)).toEqual(["Salaire AAA"]);
    expect(backup.data.exceptions.map((e) => e.label)).toEqual(["Prime AAA"]);
    expect(backup.data.loans.map((l) => l.name)).toEqual(["Prêt AAA"]);
    expect(backup.data.goals.map((g) => [g.name, g.primary])).toEqual([["Objectif AAA", true]]);
    expect(backup.data.checkIns[0]?.goalBalances.map((b) => b.balance)).toEqual(["123.00"]);
    expect(backup.data.checkIns).toHaveLength(1);
    const text = serializeBackup(backup);
    expect(text).not.toContain("BBB");
    expect(text).not.toContain(b.id);
  });
});
