/**
 * Several bank statements per month (issue #115): named accounts with their own mapping, and each
 * statement's summary saved with the check-in in one transaction. Per user (RLS), kept with their
 * account name when the account is deleted, removed with the check-in. Fake data, throwaway users.
 * Requires `supabase start`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { BankStatement, BudgetSettings, MonthlyActualDraft } from "@/lib/domain/types";
import type { CsvMapping } from "@/lib/import/bank-csv";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  emergencyTarget: 400000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};
const MAPPING: CsvMapping = {
  header: ["Date", "Libellé", "Montant"],
  separator: ";",
  date: 0,
  label: 1,
  amount: 2,
  debit: null,
  credit: null,
  decimal: ",",
  dateFormat: "dmy",
};

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;
let food: string;

const statement = (accountId: string | null, accountName: string, actual: number): BankStatement => ({
  accountId,
  accountName,
  fileName: `${accountName}.csv`,
  fingerprint: "0123456789abcdef",
  transactionCount: 4,
  totalIn: 0,
  totalOut: actual,
  lineTotals: [{ budgetLineId: food, actual }],
});

const actual = (statements?: BankStatement[]): MonthlyActualDraft => ({
  month: "2027-01",
  income: 0,
  expenses: 50000,
  emergencySavings: 0,
  freeSavings: 0,
  loanBalances: [],
  goalBalances: [],
  lines: [
    { kind: "line", direction: "expense", category: "variable", budgetLineId: food, exceptionId: null, label: "Courses", planned: 40000, actual: 50000 },
  ],
  frozen: null,
  ...(statements ? { statements } : {}),
});

beforeEach(async () => {
  [a, b] = await Promise.all([createTestUser("stmt-a"), createTestUser("stmt-b")]);
  repo = new SupabaseFinanceRepository(a.client);
  await repo.saveBudget(settings, [{ category: "variable", label: "Courses", amount: 40000, position: 0, startMonth: null, endMonth: null }]);
  food = (await repo.load()).lines[0]!.id;
});
afterEach(() => Promise.all([deleteTestUser(a), deleteTestUser(b)]));

describe("bank accounts (#115)", () => {
  it("creates, renames, saves a mapping and deletes an account", async () => {
    const created = await repo.createBankAccount("  Compte courant  ", null);
    expect(created).toMatchObject({ name: "Compte courant", mapping: null });
    await repo.updateBankAccount(created.id, { name: "Compte BNP", mapping: MAPPING });
    expect((await repo.load()).bankAccounts).toEqual([{ id: created.id, name: "Compte BNP", mapping: MAPPING }]);
    await repo.deleteBankAccount(created.id);
    expect((await repo.load()).bankAccounts).toEqual([]);
  });

  it("refuses two accounts with the same name", async () => {
    await repo.createBankAccount("Revolut", null);
    await expect(repo.createBankAccount("Revolut", null)).rejects.toThrow();
  });
});

describe("statements saved with the check-in (#115)", () => {
  it("AC-01 / AC-02 — saves the month's statements with it, replaces them on the next save, keeps them when omitted", async () => {
    const bnp = await repo.createBankAccount("BNP", MAPPING);
    const rev = await repo.createBankAccount("Revolut", null);
    await repo.saveActual(actual([statement(bnp.id, "BNP", 42000), statement(rev.id, "Revolut", 8000)]));
    let saved = (await repo.load()).actuals[0]!;
    expect(saved.statements).toEqual([statement(bnp.id, "BNP", 42000), statement(rev.id, "Revolut", 8000)]);

    // Another save without the statements field keeps them.
    await repo.saveActual(actual());
    expect((await repo.load()).actuals[0]!.statements).toHaveLength(2);

    // Removing one (the form sends the remaining list) leaves the other.
    await repo.saveActual(actual([statement(rev.id, "Revolut", 8000)]));
    saved = (await repo.load()).actuals[0]!;
    expect(saved.statements).toEqual([statement(rev.id, "Revolut", 8000)]);
  });

  it("AC-07 — deleting an account keeps the check-in's amounts and the statement's account name", async () => {
    const rev = await repo.createBankAccount("Revolut", null);
    await repo.saveActual(actual([statement(rev.id, "Revolut", 8000)]));
    await repo.deleteBankAccount(rev.id);
    const saved = (await repo.load()).actuals[0]!;
    expect(saved.statements).toEqual([statement(null, "Revolut", 8000)]);
    expect(saved.lines[0]!.actual).toBe(50000);
  });

  it("goes with the check-in when it is deleted", async () => {
    await repo.saveActual(actual([statement(null, "Revolut", 8000)]));
    await repo.deleteActual("2027-01");
    const { data } = await a.client.from("bank_statements").select("id");
    expect(data).toEqual([]);
  });

  it("security — another user sees nor uses the accounts and statements (RLS)", async () => {
    const rev = await repo.createBankAccount("Revolut", MAPPING);
    await repo.saveActual(actual([statement(rev.id, "Revolut", 8000)]));
    const other = new SupabaseFinanceRepository(b.client);
    const theirs = await other.load();
    expect(theirs.bankAccounts).toEqual([]);
    expect((await b.client.from("bank_statements").select("id")).data).toEqual([]);
    // Renaming or deleting someone else's account changes nothing.
    await expect(other.updateBankAccount(rev.id, { name: "Piraté" })).rejects.toThrow();
    await other.deleteBankAccount(rev.id);
    expect((await repo.load()).bankAccounts).toEqual([{ id: rev.id, name: "Revolut", mapping: MAPPING }]);
    // Their check-in cannot point at it.
    await other.saveBudget(settings, []);
    await expect(other.saveActual({ ...actual([statement(rev.id, "Revolut", 8000)]), lines: [] })).rejects.toThrow();
  });
});
