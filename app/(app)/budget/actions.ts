/**
 * Form actions, run in the browser (static app). Validation happens here for the UI; the
 * database constraints and RLS remain the real safeguards.
 */
import { errorMessage, reportError } from "@/lib/errors";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { type Errors, type ExceptionForm, validateBudget, validateException } from "@/lib/domain/validation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parsePayload } from "./budget-form-state";
import { EMPTY_EXCEPTION_FORM, readExceptionForm, readExceptionId } from "./exceptions-view";

export interface BudgetActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Field errors: startMonth, movingGoal…, lines.<index>.label / lines.<index>.amount. */
  errors: Errors;
  /** Client keys of the submitted lines, in submission order (maps lines.<index> back to rows). */
  lineKeys: string[];
}

/** Saves the parameters and all budget lines. The whole form arrives as one JSON field. */
export async function saveBudgetAction(_prev: BudgetActionState, formData: FormData): Promise<BudgetActionState> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) return { status: "error", message: "Session expirée : reconnectez-vous.", errors: {}, lineKeys: [] };

  const payload = parsePayload(formData.get("payload"));
  if (!payload) return { status: "error", message: "Formulaire invalide. Rechargez la page.", errors: {}, lineKeys: [] };

  const result = validateBudget(payload.form);
  if (!result.ok) {
    return {
      status: "error",
      message: "Certains champs sont invalides. Corrigez-les puis enregistrez à nouveau.",
      errors: result.errors,
      lineKeys: payload.keys,
    };
  }

  try {
    await getRepository().saveBudget(result.value.settings, result.value.lines);
  } catch (error) {
    reportError(error, "budget.save");
    const message = errorMessage(error, "Enregistrement impossible pour le moment. Réessayez.");
    return { status: "error", message, errors: {}, lineKeys: payload.keys };
  }
  notifyDataChanged();
  return { status: "success", message: "Budget enregistré.", errors: {}, lineKeys: payload.keys };
}

export type ExceptionFormState =
  | { status: "idle"; values: ExceptionForm }
  | { status: "error"; message: string; errors: Errors; values: ExceptionForm }
  | { status: "success"; message: string; values: ExceptionForm };

export type DeleteExceptionState = { status: "idle" } | { status: "error"; message: string } | { status: "success" };

const EXCEPTION_NOT_FOUND = "Exception introuvable : elle a peut-être déjà été supprimée. Rechargez la page.";

/** Adds a one-off exception (SPEC D14), independently of the main budget form. Re-validated here. */
export async function addExceptionAction(_prev: ExceptionFormState, formData: FormData): Promise<ExceptionFormState> {
  const values = readExceptionForm(formData);
  const validated = validateException(values);
  if (!validated.ok) {
    return { status: "error", message: "Certains champs sont à corriger.", errors: validated.errors, values };
  }
  try {
    await getRepository().addException(validated.value);
  } catch (error) {
    reportError(error, "budget.addException");
    const message = errorMessage(error, "Ajout impossible pour le moment. Réessayez dans un instant.");
    return { status: "error", message, errors: {}, values };
  }
  notifyDataChanged();
  return { status: "success", message: `« ${validated.value.label} » a été ajouté.`, values: EMPTY_EXCEPTION_FORM };
}

/** Deletes one exception. Only the id is read from the client. */
export async function deleteExceptionAction(_prev: DeleteExceptionState, formData: FormData): Promise<DeleteExceptionState> {
  const id = readExceptionId(formData);
  if (!id) return { status: "error", message: EXCEPTION_NOT_FOUND };
  try {
    await getRepository().deleteException(id);
  } catch (error) {
    reportError(error, "budget.deleteException");
    const fallback = "Suppression impossible pour le moment. Réessayez dans un instant.";
    return { status: "error", message: errorMessage(error, fallback, { not_found: EXCEPTION_NOT_FOUND }) };
  }
  notifyDataChanged();
  return { status: "success" };
}
