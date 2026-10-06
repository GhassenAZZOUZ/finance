/**
 * Form actions, run in the browser (static app). Validation happens here for the UI; the
 * database constraints and RLS remain the real safeguards.
 */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { checkInRows } from "@/lib/domain/actual-lines";
import { plannedDeposits, withComputedBalances } from "@/lib/domain/deposits";
import { toActualInput, withPlan } from "@/lib/domain/plan";
import { applyRebaseCorrections, frozenFor, planRebase } from "@/lib/domain/rebase";
import { type ActualForm, type Errors, parseAmount, parseMonth, validateActual } from "@/lib/domain/validation";
import { type ActualStatus, type YearMonth, compareActual } from "@/lib/engine";
import { errorMessage, reportError } from "@/lib/errors";
import { lastOpenMonth } from "@/lib/domain/payday";
import { currentDate, currentYearMonth } from "@/lib/format";
import { parseStatements } from "@/lib/import/statements";
import { earlyLoanBalances } from "./logic";

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
    const goalIds = snapshot.goals.map((g) => g.id);
    // The month's rows come from the saved budget, never from the client (#72).
    const month = parseMonth(text(formData, "month"));
    const rows = month.ok ? checkInRows(snapshot.lines, snapshot.exceptions, snapshot.settings, month.value) : [];
    const form: ActualForm = {
      month: text(formData, "month"),
      lines: rows.map((row) => ({ key: row.key, actual: text(formData, `line.${row.key}`) })),
      emergencySavings: text(formData, "emergencySavings"),
      freeSavings: text(formData, "freeSavings"),
      loanBalances: activeLoanIds.map((loanId) => ({ loanId, balance: text(formData, `loan.${loanId}`) })),
      goalBalances: goalIds.map((goalId) => ({ goalId, balance: text(formData, `goal.${goalId}`) })),
    };
    // The next month opens once its first income is paid (SPEC D29); recomputed here, never trusted.
    const currentMonth = currentYearMonth();
    const openUntil = lastOpenMonth(currentMonth, currentDate(), snapshot.lines, snapshot.incomePayments);
    const { snapshot: computed, plan } = withPlan(snapshot);
    const { settings, goals } = snapshot;
    // An early month's loans are not entered: the plan's balances after that month's payment.
    if (plan && form.month === openUntil && openUntil !== currentMonth) {
      form.loanBalances = earlyLoanBalances(plan.result, snapshot.settings.startMonth, form.month, activeLoanIds);
    }
    const validated = validateActual(form, {
      startMonth: snapshot.settings.startMonth,
      currentMonth: openUntil,
      activeLoanIds,
      goalIds,
      rows,
      // The savings fields are the month's deposits (SPEC D33), compared with the plan's.
      ...(plan && month.ok
        ? {
            deposits: {
              planned: plannedDeposits(plan.result, settings, goals, month.value),
              goalNames: Object.fromEntries(goals.map((g) => [g.id, g.name])),
            },
          }
        : {}),
    });
    if (!validated.ok) {
      return { status: "error", message: "Certains champs sont à corriger.", errors: validated.errors };
    }

    // The balances with this month's deposits: no pot may go below 0 (a withdrawal larger than it).
    const others = snapshot.actuals.filter((a) => a.month !== validated.value.month);
    const saved = { id: "", ...validated.value };
    const mine = plan
      ? (withComputedBalances(plan.result, settings, goals, [...others, saved]).find((a) => a.month === saved.month) ?? saved)
      : saved;
    const negative: Record<string, string> = {};
    const NEGATIVE = "Le solde deviendrait négatif";
    if (mine.emergencySavings < 0) negative.emergencySavings = NEGATIVE;
    if (mine.freeSavings < 0) negative.freeSavings = NEGATIVE;
    for (const b of mine.goalBalances) if (b.balance < 0) negative[`goal.${b.goalId}`] = NEGATIVE;
    if (Object.keys(negative).length > 0) {
      return { status: "error", message: "Certains champs sont à corriger.", errors: negative };
    }

    // The month's bank statements (#115), when the form sends them: the user's accounts and lines only.
    const statements = formData.has("statements")
      ? parseStatements(formData.get("statements"), {
          accountIds: new Set((snapshot.bankAccounts ?? []).map((a) => a.id)),
          lineIds: new Set(snapshot.lines.map((l) => l.id)),
        })
      : undefined;
    if (statements === null) {
      return { status: "error", message: "Les relevés importés n’ont pas pu être lus. Rechargez la page.", errors: {} };
    }

    // Freeze what the plan expects for that month (SPEC D16), keeping values already frozen.
    const existing = computed.actuals.find((a) => a.month === validated.value.month);
    const draft = {
      ...validated.value,
      frozen: plan ? frozenFor(validated.value.month, plan, existing) : null,
      ...(statements ? { statements } : {}),
    };
    await repo.saveActual(draft);
    const comparison = plan ? compareActual(toActualInput({ ...mine, frozen: draft.frozen }), plan.result, plan.input.budget) : null;
    notifyDataChanged();
    return { status: "saved", month: validated.value.month, result: comparison?.status ?? null };
  } catch (error) {
    reportError(error, "suivi.saveActual");
    const message = errorMessage(error, "Enregistrement impossible pour le moment. Réessayez dans un instant.");
    return { status: "error", message, errors: {} };
  }
}

export type DeleteActualResult = { ok: true } | { ok: false; message: string };

export async function deleteActualAction(month: string): Promise<DeleteActualResult> {
  const parsed = parseMonth(month);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  try {
    await getRepository().deleteActual(parsed.value);
  } catch (error) {
    reportError(error, "suivi.deleteActual");
    return { ok: false, message: errorMessage(error, "Suppression impossible pour le moment. Réessayez dans un instant.") };
  }
  notifyDataChanged();
  return { ok: true };
}

export type RebaseResult =
  | { ok: true; newStartMonth: YearMonth }
  | { ok: false; message: string; errors?: Errors };

/**
 * "Recaler le plan" (SPEC D16): freezes the history, then restarts the plan the month after the
 * latest check-in with its real balances. Everything is recomputed from the saved data. `typed`
 * holds the starting values corrected by hand in the preview (#100), by field key, as typed.
 */
export async function rebasePlanAction(typed: Readonly<Record<string, string>> = {}): Promise<RebaseResult> {
  const values: Record<string, number> = {};
  const errors: Errors = {};
  for (const [key, raw] of Object.entries(typed)) {
    const parsed = parseAmount(raw);
    if (parsed.ok) values[key] = parsed.value ?? 0;
    else errors[key] = parsed.error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, message: "Corrigez les montants en erreur.", errors };
  try {
    const repo = getRepository();
    // The re-base starts from the computed balances (SPEC D33).
    const { snapshot, plan } = withPlan(await repo.load());
    const rebase = plan ? planRebase(snapshot, plan) : null;
    if (!plan || !rebase) return { ok: false, message: "Aucun mois de suivi après le début du plan : rien à recaler." };
    const loanLabel = (id: string) => {
      const j = snapshot.loans.findIndex((l) => l.id === id);
      return plan.result.loans[j]?.displayName ?? "Crédit";
    };
    await repo.rebasePlan(applyRebaseCorrections(rebase, snapshot.loans, values, loanLabel));
    notifyDataChanged();
    return { ok: true, newStartMonth: rebase.newStartMonth };
  } catch (error) {
    reportError(error, "suivi.rebase");
    return { ok: false, message: errorMessage(error, "Recalage impossible pour le moment. Réessayez dans un instant.") };
  }
}

/** « Annuler le recalage » (#100): the plan as it was just before the latest re-base, all or nothing. */
export async function undoRebaseAction(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await getRepository().undoRebase();
  } catch (error) {
    reportError(error, "suivi.undo-rebase");
    return {
      ok: false,
      message: errorMessage(error, "Annulation impossible : le recalage a peut-être déjà expiré. Votre plan n’a pas changé.", {
        P0002: "Ce recalage ne peut plus être annulé : un mois a été saisi ou le budget modifié depuis.",
      }),
    };
  }
  notifyDataChanged();
  return { ok: true };
}
