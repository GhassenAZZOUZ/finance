import type { CsvMapping } from "@/lib/import/bank-csv";
import type { BankRule } from "@/lib/import/bank-rules";
import type {
  BudgetException,
  BudgetExceptionDraft,
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  FrozenPlan,
  Loan,
  LoanDraft,
  MonthlyActualDraft,
  SavingsGoal,
  SavingsGoalDraft,
} from "@/lib/domain/types";
import type { RebasePlan } from "@/lib/domain/rebase";
import type { ImportPlan } from "@/lib/import/apply";

/** The writes of a re-base (`planRebase`), without its preview-only fields. */
export type RebaseChanges = Pick<RebasePlan, "freezes" | "settings" | "loanUpdates" | "loansToArchive" | "goalUpdates">;

/**
 * Data access for the signed-in user. Pages and server actions only talk to this interface,
 * so a future import feature (V2) can reuse it with any storage.
 * Money is in cents; implementations convert to the storage format.
 */
export interface FinanceRepository {
  load(): Promise<FinanceSnapshot>;
  /** Saves the parameters and replaces the budget lines with `lines` (ids kept when present). */
  saveBudget(settings: BudgetSettings, lines: BudgetLineDraft[]): Promise<void>;
  /** Saves the plan parameters only (lines untouched). */
  saveSettings(settings: BudgetSettings): Promise<void>;
  /** Freezes planned values on existing check-ins that have none yet (SPEC D16). */
  freezeActuals(items: { month: string; frozen: FrozenPlan }[]): Promise<void>;
  /**
   * « Recaler le plan » (SPEC D16), all-or-nothing: freezes the history, saves the settings,
   * updates / archives the loans and updates the goals.
   */
  rebasePlan(changes: RebaseChanges): Promise<void>;
  /** Template import (SPEC D20), all-or-nothing: budget replaced, then loan removals, updates, creations. */
  applyImport(plan: ImportPlan): Promise<void>;
  addException(draft: BudgetExceptionDraft): Promise<BudgetException>;
  deleteException(id: string): Promise<void>;
  createLoan(draft: LoanDraft): Promise<Loan>;
  updateLoan(id: string, draft: LoanDraft): Promise<void>;
  /** Deletes the loan, or archives it when check-ins reference it (SPEC D8). */
  removeLoan(id: string): Promise<"deleted" | "archived">;
  /** Creates or replaces the check-in of `draft.month`. */
  saveActual(draft: MonthlyActualDraft): Promise<void>;
  deleteActual(month: string): Promise<void>;
  /** Adds a savings goal with this priority (SPEC D23); the first one becomes the primary goal. */
  createGoal(draft: SavingsGoalDraft, priority: number): Promise<SavingsGoal>;
  updateGoal(id: string, draft: SavingsGoalDraft): Promise<void>;
  /**
   * Deletes a goal (and its check-in balances) and closes the priority gap. Deleting the primary
   * goal while others remain needs `newPrimaryId`, the goal that becomes primary.
   */
  deleteGoal(id: string, newPrimaryId?: string): Promise<void>;
  /** Sets priorities 1..n in this order (all goal ids). */
  orderGoals(ids: string[]): Promise<void>;
  /** Turns the monthly e-mail reminder on or off (SPEC D25). */
  setReminder(enabled: boolean): Promise<void>;
  /** Saves (or forgets, with null) the column mapping of the user's bank CSV (SPEC D30). */
  setBankCsvMapping(mapping: CsvMapping | null): Promise<void>;
  /** Stores a bank import (SPEC D31): replaces the month's per-line totals, upserts the learnt rules. */
  saveBankImport(month: string, totals: { budgetLineId: string; actual: number }[], rules: Omit<BankRule, "id">[]): Promise<void>;
  deleteBankRule(id: string): Promise<void>;
  /** Records (or clears, with null) the actual date an income line was paid for a month (SPEC D29). */
  setIncomePayment(month: string, budgetLineId: string, paidOn: string | null): Promise<void>;
  /** Deletes the signed-in user's account and every row of theirs, for good (SPEC D26). */
  deleteAccount(): Promise<void>;
}

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
