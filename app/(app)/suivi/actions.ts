/**
 * Form actions, run in the browser (static app). Validation happens here for the UI; the
 * database constraints and RLS remain the real safeguards.
 */
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { checkInRows } from "@/lib/domain/actual-lines";
import { plannedDeposits, withComputedBalances } from "@/lib/domain/deposits";
import { toActualInput, withPlan } from "@/lib/domain/plan";
import { frozenFor, planRebase } from "@/lib/domain/rebase";
import { type ActualForm, type Errors, parseMonth, validateActual } from "@/lib/domain/validation";
import { type ActualStatus, type YearMonth, compareActual } from "@/lib/engine";
import { errorMessage, reportError } from "@/lib/errors";
import { lastOpenMonth } from "@/lib/domain/payday";
import { currentDate, currentYearMonth } from "@/lib/format";
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

    // Freeze what the plan expects for that month (SPEC D16), keeping values already frozen.
    const existing = computed.actuals.find((a) => a.month === validated.value.month);
    const draft = { ...validated.value, frozen: plan ? frozenFor(validated.value.month, plan, existing) : null };
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

export type RebaseResult = { ok: true; newStartMonth: YearMonth } | { ok: false; message: string };

/**
 * "Recaler le plan" (SPEC D16): freezes the history, then restarts the plan the month after the
 * latest check-in with its real balances. Everything is recomputed from the saved data.
 */
export async function rebasePlanAction(): Promise<RebaseResult> {
  try {
    const repo = getRepository();
    // The re-base starts from the computed balances (SPEC D33).
    const { snapshot, plan } = withPlan(await repo.load());
    const rebase = plan ? planRebase(snapshot, plan) : null;
    if (!rebase) return { ok: false, message: "Aucun mois de suivi après le début du plan : rien à recaler." };
    await repo.rebasePlan(rebase);
    notifyDataChanged();
    return { ok: true, newStartMonth: rebase.newStartMonth };
  } catch (error) {
    reportError(error, "suivi.rebase");
    return { ok: false, message: errorMessage(error, "Recalage impossible pour le moment. Réessayez dans un instant.") };
  }
}
