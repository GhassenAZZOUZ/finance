/**
 * Pro plan, browser side (monetization epic #150). The app only reads the rights written by the
 * Stripe webhook (SPEC D35) and asks the `create-checkout` Edge Function for a Checkout page (US-4).
 */
import { supabaseBrowser } from "@/lib/supabase/client";

export type Plan = "monthly" | "yearly";

/** Shown prices (owner decision 2026-10-06); what is charged is the Stripe price of each plan. */
export const PLANS: Record<Plan, { label: string; price: string; detail: string }> = {
  monthly: { label: "Mensuel", price: "4,99 €", detail: "par mois" },
  yearly: { label: "Annuel", price: "39 €", detail: "par an, soit 3,25 € par mois" },
};

export const TRIAL_DAYS = 14;

export interface Entitlement {
  isPro: boolean;
  status: string;
  /** ISO timestamp. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** The signed-in user's rights; null = Free (never subscribed). */
export async function fetchEntitlement(): Promise<Entitlement | null> {
  const { data, error } = await supabaseBrowser()
    .from("entitlements")
    .select("is_pro, status, current_period_end, cancel_at_period_end")
    .maybeSingle<{ is_pro: boolean; status: string; current_period_end: string | null; cancel_at_period_end: boolean }>();
  if (error) throw error;
  return data
    ? { isPro: data.is_pro, status: data.status, currentPeriodEnd: data.current_period_end, cancelAtPeriodEnd: data.cancel_at_period_end }
    : null;
}

export type CheckoutError = "not_configured" | "already_subscribed" | "unauthorized" | "failed";

/** The Stripe Checkout URL for this plan, or why there is none. */
export async function createCheckout(plan: Plan): Promise<{ url: string } | { error: CheckoutError }> {
  const { data, error } = await supabaseBrowser().functions.invoke<{ url?: string; error?: string }>("create-checkout", { body: { plan } });
  if (data?.url) return { url: data.url };
  // functions-js puts the response of a non-2xx call in error.context.
  let code = data?.error;
  if (!code && error && "context" in error && error.context instanceof Response) {
    code = ((await error.context.json().catch(() => ({}))) as { error?: string }).error;
  }
  return { error: code === "not_configured" || code === "already_subscribed" || code === "unauthorized" ? code : "failed" };
}

export const CHECKOUT_MESSAGES: Record<CheckoutError, string> = {
  not_configured: "Le paiement n’est pas encore ouvert. Réessayez plus tard.",
  already_subscribed: "Vous êtes déjà abonné à Boussole Pro.",
  unauthorized: "Session expirée : reconnectez-vous.",
  failed: "Le paiement n’a pas pu démarrer. Réessayez dans un instant.",
};
