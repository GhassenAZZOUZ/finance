/**
 * Contextual paywall (issue #140, US-3): opened when a Free limit is reached, never at sign-up.
 * The database refuses writes beyond a limit (US-2, `limitOf()`); the interface limits the history
 * and the plan horizon (owner decision 2026-10-07). One host (`PaywallHost`) shows it.
 */
import type { LimitKey } from "@/lib/errors";

/** Limits applied by the database (writes) or by the interface (what is shown). */
export type PaywallReason = LimitKey | "history_limit" | "plan_limit";

export const PAYWALL_COPY: Record<PaywallReason, { title: string; text: string }> = {
  loans_limit: {
    title: "Suivez tous vos crédits",
    text: "Le plan gratuit compte 1 crédit. Avec Boussole Pro, suivez-en jusqu’à 6 et voyez lequel rembourser en premier.",
  },
  goals_limit: {
    title: "Plusieurs objectifs d’épargne",
    text: "Le plan gratuit compte 1 objectif d’épargne. Avec Boussole Pro, ajoutez-en autant que nécessaire.",
  },
  history_limit: {
    title: "Tout votre historique",
    text: "Le plan gratuit affiche les 3 derniers mois de suivi. Avec Boussole Pro, retrouvez tous vos mois (ils restent enregistrés).",
  },
  plan_limit: {
    title: "Votre plan sur 25 ans",
    text: "Le plan gratuit affiche les 3 prochains mois. Avec Boussole Pro, voyez votre plan jusqu’au bout.",
  },
};

/** Free plan's visible horizon, in months, for the history and the plan (interface only). */
export const FREE_VISIBLE_MONTHS = 3;

const listeners = new Set<(reason: PaywallReason) => void>();

export function openPaywall(reason: PaywallReason): void {
  for (const listener of listeners) listener(reason);
}

export function onPaywall(listener: (reason: PaywallReason) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
