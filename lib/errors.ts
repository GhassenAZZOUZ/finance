/**
 * Error reporting and user-facing messages for failed data operations.
 * Every data-related catch calls `reportError`, so a failure is never silently swallowed.
 */
import { RepositoryError } from "@/lib/data/repository";

/** A remote reporter (e.g. Sentry); console.error always runs, reporters come on top. */
export type ErrorReporter = (error: unknown, context: string) => void;

const reporters = new Set<ErrorReporter>();

/** Plugs a remote reporter in; returns the function that unplugs it. */
export function addErrorReporter(reporter: ErrorReporter): () => void {
  reporters.add(reporter);
  return () => reporters.delete(reporter);
}

/** Logs the error with a context label ("budget.save", "import.apply"…) and forwards it to the reporters. */
export function reportError(error: unknown, context: string): void {
  console.error(`[${context}]`, error);
  for (const reporter of reporters) {
    // A broken reporter must not break the save flow it reports on.
    try {
      reporter(error, context);
    } catch (reporterError) {
      console.error("[errors.reporter]", reporterError);
    }
  }
}

/** Messages by `RepositoryError.code`: the repository's own codes, then Postgres / PostgREST ones. */
const MESSAGES: Record<string, string> = {
  not_found: "Élément introuvable : il a peut-être déjà été supprimé. Rechargez la page.",
  // The Android app shows its offline copy (#84): nothing can be changed until it reconnects.
  offline: "Hors ligne : reconnectez-vous à Internet pour modifier vos données.",
  forbidden: "Cette action n’est pas autorisée.",
  // insufficient_privilege: RLS refused the row (usually an expired or foreign session).
  "42501": "Accès refusé : reconnectez-vous puis réessayez.",
  // JWT expired / invalid.
  PGRST301: "Session expirée : reconnectez-vous.",
  PGRST303: "Session expirée : reconnectez-vous.",
  "23505": "Cette donnée existe déjà. Rechargez la page.",
  "23503": "Une donnée liée est introuvable. Rechargez la page.",
  "23514": "Valeur refusée par la base de données. Vérifiez les montants saisis.",
  "23502": "Valeur manquante refusée par la base de données. Vérifiez le formulaire.",
  "22P02": "Valeur refusée par la base de données. Vérifiez le formulaire.",
  "22003": "Montant trop grand pour être enregistré.",
  // no_data_found: a row the save functions had to update is gone.
  P0002: "Élément introuvable : il a peut-être déjà été supprimé. Rechargez la page.",
  // Raised at commit when savings goals would be left without a primary one (tech-debt 6).
  P0003: "Il faut un objectif principal : choisissez celui qui remplace l’actuel.",
  // invalid_parameter_value: raised by the save functions on a malformed payload.
  "22023": "Formulaire invalide. Rechargez la page.",
};

export const NETWORK_MESSAGE = "Connexion impossible : vérifiez votre réseau puis réessayez.";

/** Free plan limits refused by the database (#139, SQLSTATE PT402 = HTTP 402, message = limit key). */
export type LimitKey = "loans_limit" | "goals_limit";

export const LIMIT_MESSAGES: Record<LimitKey, string> = {
  loans_limit: "Le plan gratuit compte 1 crédit : passez à Boussole Pro pour en suivre davantage.",
  goals_limit: "Le plan gratuit compte 1 objectif d’épargne : passez à Boussole Pro pour en ajouter d’autres.",
};

/** The Free limit an error is about, or null: what the paywall (US-3) needs. */
export function limitOf(error: unknown): LimitKey | null {
  if (!(error instanceof RepositoryError) || error.code !== "PT402") return null;
  return error.message in LIMIT_MESSAGES ? (error.message as LimitKey) : null;
}

/** fetch() rejects with a TypeError when the network is down; supabase-js keeps that message. */
function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message);
}

/**
 * French message for a failed data operation: a specific one for known codes (`overrides` first),
 * `fallback` (the generic « Réessayez ») only for unknown errors.
 */
export function errorMessage(error: unknown, fallback: string, overrides: Record<string, string> = {}): string {
  const limit = limitOf(error);
  if (limit) return LIMIT_MESSAGES[limit];
  if (error instanceof RepositoryError && error.code) {
    const message = overrides[error.code] ?? MESSAGES[error.code];
    if (message) return message;
  }
  if (isNetworkError(error)) return NETWORK_MESSAGE;
  return fallback;
}
