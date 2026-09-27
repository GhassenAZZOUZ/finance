"use server";

import { refresh } from "next/cache";
import { getRepository } from "@/lib/data/session";
import { type Errors, validateBudget } from "@/lib/domain/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parsePayload } from "./budget-form-state";

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
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { status: "error", message: "Session expirée : reconnectez-vous.", errors: {}, lineKeys: [] };

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
    await (await getRepository()).saveBudget(result.value.settings, result.value.lines);
  } catch {
    return { status: "error", message: "Enregistrement impossible pour le moment. Réessayez.", errors: {}, lineKeys: payload.keys };
  }
  refresh();
  return { status: "success", message: "Budget enregistré.", errors: {}, lineKeys: payload.keys };
}
