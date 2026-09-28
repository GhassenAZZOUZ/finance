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
  addException(draft: BudgetExceptionDraft): Promise<BudgetException>;
  deleteException(id: string): Promise<void>;
  createLoan(draft: LoanDraft): Promise<Loan>;
  updateLoan(id: string, draft: LoanDraft): Promise<void>;
  /** Deletes the loan, or archives it when check-ins reference it (SPEC D8). */
  removeLoan(id: string): Promise<"deleted" | "archived">;
  /** Creates or replaces the check-in of `draft.month`. */
  saveActual(draft: MonthlyActualDraft): Promise<void>;
  deleteActual(month: string): Promise<void>;
  /** Adds an extra savings goal with this priority (SPEC D23). */
  createGoal(draft: SavingsGoalDraft, priority: number): Promise<SavingsGoal>;
  /** Updates a goal; the primary goal (id "moving") writes the moving fund of the settings. */
  updateGoal(id: string, draft: SavingsGoalDraft): Promise<void>;
  /** Deletes an extra goal (and its check-in balances); the primary goal cannot be deleted. */
  deleteGoal(id: string): Promise<void>;
  /** Sets priorities 1..n in this order (all goal ids, "moving" included). */
  orderGoals(ids: string[]): Promise<void>;
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
