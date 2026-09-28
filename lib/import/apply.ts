/**
 * Applies a template import (SPEC D20): the budget and the active loans are **replaced** by the
 * file's; check-ins and one-off exceptions are kept. Existing rows are reused (same line slot,
 * same loan name) so importing the same file twice changes nothing.
 */
import type { FinanceRepository } from "@/lib/data/repository";
import type { BudgetLineDraft, BudgetSettings, FinanceSnapshot, LoanDraft } from "@/lib/domain/types";
import type { TemplateData } from "./template";

export interface ImportPlan {
  settings: BudgetSettings;
  /** With the id of the existing line in the same slot (category, rank), when there is one. */
  lines: BudgetLineDraft[];
  loanUpdates: { id: string; draft: LoanDraft }[];
  loanCreates: LoanDraft[];
  /** Active loans absent from the file: deleted, or archived when check-ins use them (D8). */
  loanRemovals: string[];
}

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
  const available = [...snapshot.loans];
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
    lines,
    loanUpdates,
    loanCreates,
    loanRemovals: available.map((l) => l.id),
  };
}

/**
 * Writes the plan through the repository. Not atomic: on failure the caller shows an error and
 * the user retries; the same file then converges to the same result (idempotent).
 * Removals come first so the 6-active-loan limit holds at every step.
 */
export async function applyImport(repo: FinanceRepository, plan: ImportPlan): Promise<void> {
  await repo.saveBudget(plan.settings, plan.lines);
  for (const id of plan.loanRemovals) await repo.removeLoan(id);
  for (const { id, draft } of plan.loanUpdates) await repo.updateLoan(id, draft);
  for (const draft of plan.loanCreates) await repo.createLoan(draft);
}
