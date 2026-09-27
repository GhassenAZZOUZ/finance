"use server";

import { refresh } from "next/cache";
import { getRepository } from "@/lib/data/session";
import { computePlan, toActualInput } from "@/lib/domain/plan";
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
    const repo = await getRepository();
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

    await repo.saveActual(validated.value);
    // The plan does not depend on the check-ins, so the pre-save plan gives the new status.
    const plan = computePlan(snapshot);
    const comparison = plan
      ? compareActual(toActualInput({ id: "", ...validated.value }), plan.result, plan.input.budget)
      : null;
    refresh();
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
    await (await getRepository()).deleteActual(parsed.value);
  } catch {
    return { ok: false, message: "Suppression impossible pour le moment. Réessayez dans un instant." };
  }
  refresh();
  return { ok: true };
}
