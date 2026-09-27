/**
 * Form actions, run in the browser (static app). Validation happens here for the UI; the
 * database constraints and RLS remain the real safeguards.
 */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { computePlan, toActualInput } from "@/lib/domain/plan";
import { frozenFor, planRebase } from "@/lib/domain/rebase";
import { type ActualForm, type Errors, parseMonth, validateActual } from "@/lib/domain/validation";
import { type ActualStatus, type YearMonth, compareActual } from "@/lib/engine";
import { currentYearMonth } from "@/lib/format";

export type SaveActualState =
  | { status: "idle" }
  | { status: "saved"; month: YearMonth; result: ActualStatus | null }
  | { status: "error"; message: string; errors: Errors };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");

/** Creates or replaces a monthly check-in (SPEC §8.1). Context is read on the server, never trusted from the client. */
export async function saveActualAction(_prev: SaveActualState, formData: FormData): Promise<SaveActualState> {
  try {
    const repo = getRepository();
    const snapshot = await repo.load();
    if (!snapshot.settings) {
      return { status: "error", message: "Renseignez d’abord votre budget.", errors: {} };
    }
    const activeLoanIds = snapshot.loans.map((l) => l.id);
    const form: ActualForm = {
      month: text(formData, "month"),
      income: text(formData, "income"),
      expenses: text(formData, "expenses"),
      movingSavings: text(formData, "movingSavings"),
      emergencySavings: text(formData, "emergencySavings"),
      freeSavings: text(formData, "freeSavings"),
      loanBalances: activeLoanIds.map((loanId) => ({ loanId, balance: text(formData, `loan.${loanId}`) })),
    };
    const validated = validateActual(form, {
      startMonth: snapshot.settings.startMonth,
      currentMonth: currentYearMonth(),
      activeLoanIds,
    });
    if (!validated.ok) {
      return { status: "error", message: "Certains champs sont à corriger.", errors: validated.errors };
    }

    // Freeze what the plan expects for that month (SPEC D16), keeping values already frozen.
    const plan = computePlan(snapshot);
    const existing = snapshot.actuals.find((a) => a.month === validated.value.month);
    const draft = { ...validated.value, frozen: plan ? frozenFor(validated.value.month, plan, existing) : null };
    await repo.saveActual(draft);
    const comparison = plan ? compareActual(toActualInput({ id: "", ...draft }), plan.result, plan.input.budget) : null;
    notifyDataChanged();
    return { status: "saved", month: validated.value.month, result: comparison?.status ?? null };
  } catch {
    return { status: "error", message: "Enregistrement impossible pour le moment. Réessayez dans un instant.", errors: {} };
  }
}

export type DeleteActualResult = { ok: true } | { ok: false; message: string };

export async function deleteActualAction(month: string): Promise<DeleteActualResult> {
  const parsed = parseMonth(month);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  try {
    await getRepository().deleteActual(parsed.value);
  } catch {
    return { ok: false, message: "Suppression impossible pour le moment. Réessayez dans un instant." };
  }
  notifyDataChanged();
  return { ok: true };
}

export type RebaseResult = { ok: true; newStartMonth: YearMonth } | { ok: false; message: string };

/**
 * "Recaler le plan" (SPEC D16): freezes the history, then restarts the plan the month after the
 * latest check-in with its real balances. Everything is recomputed from the saved data.
 */
export async function rebasePlanAction(): Promise<RebaseResult> {
  try {
    const repo = getRepository();
    const snapshot = await repo.load();
    const plan = computePlan(snapshot);
    const rebase = plan ? planRebase(snapshot, plan) : null;
    if (!rebase) return { ok: false, message: "Aucun mois de suivi après le début du plan : rien à recaler." };
    await repo.freezeActuals(rebase.freezes);
    await repo.saveSettings(rebase.settings);
    for (const { id, draft } of rebase.loanUpdates) await repo.updateLoan(id, draft);
    for (const id of rebase.loansToArchive) await repo.removeLoan(id);
    notifyDataChanged();
    return { ok: true, newStartMonth: rebase.newStartMonth };
  } catch {
    return { ok: false, message: "Recalage impossible pour le moment. Réessayez dans un instant." };
  }
}
