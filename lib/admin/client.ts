/**
 * Back-office, browser side (issue #156, US-13): calls the `admin` Edge Function, which decides
 * everything on the server; the page only shows what it returns.
 */
import { supabaseBrowser } from "@/lib/supabase/client";

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function callAdmin<T>(body: Record<string, unknown>): Promise<AdminResult<T>> {
  const { data, error } = await supabaseBrowser().functions.invoke<T>("admin", { body });
  if (!error) return { ok: true, data: data as T };
  // functions-js keeps the HTTP response of a non-2xx call in error.context.
  if ("context" in error && error.context instanceof Response) {
    const payload = (await error.context.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: error.context.status, error: payload.error ?? "failed" };
  }
  return { ok: false, status: 0, error: "network" };
}

export interface AdminEntry {
  userId: string;
  email: string | null;
  addedAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  admin: string;
  target: string | null;
  details: Record<string, unknown>;
}

/** French wording of the audit actions (later stories add theirs). */
export const ACTION_LABELS: Record<string, string> = {
  "admins.add": "Admin ajouté",
  "admins.remove": "Admin retiré",
};

export const ADMIN_ERRORS: Record<string, string> = {
  user_not_found: "Aucun compte avec cette adresse e-mail.",
  self: "Vous ne pouvez pas vous retirer vous-même.",
  last_admin: "Il faut garder au moins un administrateur.",
  not_admin: "Ce compte n’est pas administrateur.",
  invalid_request: "Demande invalide.",
  failed: "L’action a échoué. Réessayez dans un instant.",
  network: "Connexion impossible : vérifiez votre réseau.",
};
