/**
 * Shared fixtures for the rendered form tests. The repository is a plain object of vi.fn()
 * spies; each test file wires it in with vi.mock("@/lib/data/client-store", ...).
 */
import { vi } from "vitest";
import type { FinanceRepository } from "@/lib/data/repository";
import type { BudgetSettings, FinanceSnapshot, Loan, SavingsGoal } from "@/lib/domain/types";

export type RepositoryMock = { [K in keyof FinanceRepository]: ReturnType<typeof vi.fn<FinanceRepository[K]>> };

export function createRepositoryMock(snapshot: FinanceSnapshot = makeSnapshot()): RepositoryMock {
  return {
    load: vi.fn<FinanceRepository["load"]>(async () => snapshot),
    saveBudget: vi.fn<FinanceRepository["saveBudget"]>(async () => {}),
    saveSettings: vi.fn<FinanceRepository["saveSettings"]>(async () => {}),
    freezeActuals: vi.fn<FinanceRepository["freezeActuals"]>(async () => {}),
    rebasePlan: vi.fn<FinanceRepository["rebasePlan"]>(async () => {}),
    undoRebase: vi.fn<FinanceRepository["undoRebase"]>(async () => {}),
    applyImport: vi.fn<FinanceRepository["applyImport"]>(async () => {}),
    addException: vi.fn<FinanceRepository["addException"]>(async (draft) => ({ id: "exc-new", ...draft })),
    deleteException: vi.fn<FinanceRepository["deleteException"]>(async () => {}),
    createLoan: vi.fn<FinanceRepository["createLoan"]>(async (draft) => ({
      id: "loan-new",
      position: 0,
      archivedAt: null,
      ...draft,
    })),
    updateLoan: vi.fn<FinanceRepository["updateLoan"]>(async () => {}),
    removeLoan: vi.fn<FinanceRepository["removeLoan"]>(async () => "deleted" as const),
    saveActual: vi.fn<FinanceRepository["saveActual"]>(async () => {}),
    deleteActual: vi.fn<FinanceRepository["deleteActual"]>(async () => {}),
    createGoal: vi.fn<FinanceRepository["createGoal"]>(async (draft, priority) => ({ id: "goal-new", priority, primary: false, ...draft })),
    updateGoal: vi.fn<FinanceRepository["updateGoal"]>(async () => {}),
    deleteGoal: vi.fn<FinanceRepository["deleteGoal"]>(async () => {}),
    orderGoals: vi.fn<FinanceRepository["orderGoals"]>(async () => {}),
    setReminder: vi.fn<FinanceRepository["setReminder"]>(async () => {}),
    setIncomePayment: vi.fn<FinanceRepository["setIncomePayment"]>(async () => {}),
    setBankCsvMapping: vi.fn<FinanceRepository["setBankCsvMapping"]>(async () => {}),
    saveBankRules: vi.fn<FinanceRepository["saveBankRules"]>(async () => {}),
    deleteBankRule: vi.fn<FinanceRepository["deleteBankRule"]>(async () => {}),
    createBankAccount: vi.fn<FinanceRepository["createBankAccount"]>(async (name, mapping) => ({ id: `account-${name}`, name, mapping })),
    updateBankAccount: vi.fn<FinanceRepository["updateBankAccount"]>(async () => {}),
    deleteBankAccount: vi.fn<FinanceRepository["deleteBankAccount"]>(async () => {}),
    setLineTag: vi.fn<FinanceRepository["setLineTag"]>(async () => {}),
    deleteAccount: vi.fn<FinanceRepository["deleteAccount"]>(async () => {}),
  };
}

export function makeLoan(i: number, overrides: Partial<Loan> = {}): Loan {
  return {
    id: `loan-${i}`,
    name: `Prêt ${i}`,
    type: "Prêt personnel",
    principal: 500_000,
    principalPaidThroughMonth: null,
    apr: 0.05,
    monthlyPayment: 20_000,
    contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null, kind: "loan", creditLimit: null,
    position: i,
    archivedAt: null,
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<BudgetSettings> = {}): BudgetSettings {
  return {
    startMonth: "2026-01",
    emergencyTarget: 600_000,
    emergencyExisting: 100_000, freeSavingsExisting: 0,
    riskFreeRate: 0.03,
    earlyRepaymentPct: 0.5,
    ...overrides,
  };
}

/** The primary savings goal (the spreadsheet's moving fund, SPEC D23): 3 000 € by 2026-12 by default. */
export function primaryGoal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: "goal-primary",
    name: "Déménagement",
    target: 300_000,
    deadlineMonth: "2026-12",
    alreadySaved: 0,
    priority: 1,
    primary: true,
    ...overrides,
  };
}

/** With settings and no `goals` given, the snapshot has the default primary goal, as every user with a budget had. */
export function makeSnapshot(overrides: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  const goals = overrides.goals ?? (overrides.settings ? [primaryGoal()] : []);
  return {
    settings: null,
    lines: [],
    exceptions: [],
    loans: [],
    archivedLoans: [],
    actuals: [],
    reminderEnabled: true,
    incomePayments: [],
    ...overrides,
    goals,
  };
}
