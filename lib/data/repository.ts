import type {
  BudgetLineDraft,
  BudgetSettings,
  FinanceSnapshot,
  Loan,
  LoanDraft,
  MonthlyActualDraft,
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
  createLoan(draft: LoanDraft): Promise<Loan>;
  updateLoan(id: string, draft: LoanDraft): Promise<void>;
  /** Deletes the loan, or archives it when check-ins reference it (SPEC D8). */
  removeLoan(id: string): Promise<"deleted" | "archived">;
  /** Creates or replaces the check-in of `draft.month`. */
  saveActual(draft: MonthlyActualDraft): Promise<void>;
  deleteActual(month: string): Promise<void>;
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
