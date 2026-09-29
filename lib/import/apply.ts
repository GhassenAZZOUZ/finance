/**
 * Plans a template import (SPEC D20): the budget and the active loans are **replaced** by the
 * file's; check-ins and one-off exceptions are kept. Existing rows are reused (same line slot,
 * same loan name) so importing the same file twice changes nothing. `FinanceRepository.applyImport`
 * writes the plan all-or-nothing.
 */
import type { BudgetLineDraft, BudgetSettings, FinanceSnapshot, LoanDraft, SavingsGoalDraft } from "@/lib/domain/types";
import type { TemplateData } from "./template";

export interface ImportPlan {
  settings: BudgetSettings;
  /**
   * The file's moving fund, written to the primary goal (its name is kept); a user without goals
   * gets a primary goal with this name.
   */
  primaryGoal: SavingsGoalDraft;
  /** With the id of the existing line in the same slot (category, rank), when there is one. */
  lines: BudgetLineDraft[];
  loanUpdates: { id: string; draft: LoanDraft }[];
  loanCreates: LoanDraft[];
  /** Active loans absent from the file: deleted, or archived when check-ins use them (D8). */
  loanRemovals: string[];
}

/** The spreadsheet's single savings goal. */
export const TEMPLATE_GOAL_NAME = "Déménagement";

const loanKey = (name: string | null) => (name ?? "").trim().toLocaleLowerCase("fr");

export function planImport(snapshot: FinanceSnapshot, data: TemplateData): ImportPlan {
  const byCategory = new Map<string, string[]>();
  for (const line of [...snapshot.lines].sort((a, b) => a.position - b.position)) {
    byCategory.set(line.category, [...(byCategory.get(line.category) ?? []), line.id]);
  }
  const lines = data.lines.map((line) => {
    const id = byCategory.get(line.category)?.shift();
    return id ? { ...line, id } : line;
  });

  // Same name (case-insensitive) = same loan; unnamed loans pair up in entry order.
  // The template has no overdraft (SPEC D24): overdrafts are kept, only loans are replaced.
  const available = snapshot.loans.filter((l) => l.kind !== "overdraft");
  const loanUpdates: ImportPlan["loanUpdates"] = [];
  const loanCreates: LoanDraft[] = [];
  for (const draft of data.loans) {
    const at = available.findIndex((l) => loanKey(l.name) === loanKey(draft.name));
    if (at < 0) {
      loanCreates.push(draft);
      continue;
    }
    const [existing] = available.splice(at, 1);
    // The template has no contract end month nor IRA: keep the ones typed in the app.
    loanUpdates.push({
      id: existing!.id,
      draft: {
        ...draft,
        contractEndMonth: existing!.contractEndMonth,
        penaltyPct: existing!.penaltyPct,
        penaltyCapMonths: existing!.penaltyCapMonths,
      },
    });
  }

  return {
    settings: { ...data.settings, freeSavingsExisting: snapshot.settings?.freeSavingsExisting ?? 0 },
    primaryGoal: { name: snapshot.goals.find((g) => g.primary)?.name ?? TEMPLATE_GOAL_NAME, ...data.primaryGoal },
    lines,
    loanUpdates,
    loanCreates,
    loanRemovals: available.map((l) => l.id),
  };
}
