/** French UI labels for engine values (the engine itself is language-neutral). */
import type { ActualStatus, DebtAlert, LoanAdvice, PlanKpis } from "@/lib/engine";
import { formatMonthLong } from "./format";

export const STATUS_LABEL: Record<ActualStatus, string> = {
  onTrack: "Dans les temps",
  late: "En retard",
  mixed: "Mitigé",
};

export const ADVICE_LABEL: Record<LoanAdvice, string> = {
  highRate: "Taux élevé : à solder en priorité",
  worthIt: "Remb. anticipé intéressant (vérifier IRA)",
  keep: "Garder, épargner plutôt",
};

export const DEBT_ALERT_LABEL: Record<DebtAlert, string> = {
  ok: "OK",
  warning: "Proche du seuil",
  alert: "Au-dessus de 35 %",
};

/** Suggestions for the loan "type" field (free text). */
export const LOAN_TYPE_SUGGESTIONS = [
  "Prêt personnel",
  "Prêt affecté",
  "Revolving",
  "Prêt étudiant",
  "Prêt immobilier",
  "Dette personnelle",
] as const;

export function movingReachedText(k: PlanKpis): string {
  return k.movingReachedMonth ? formatMonthLong(k.movingReachedMonth) : "Non atteint";
}

export function movingStatusText(k: PlanKpis): string {
  return k.movingGoalMet ? "Objectif tenu" : "Objectif NON tenu : réduire dépenses ou décaler la date";
}

export function emergencyReachedText(k: PlanKpis): string {
  return k.emergencyReachedMonth ? formatMonthLong(k.emergencyReachedMonth) : "Non atteint (25 ans)";
}

export function debtFreeText(k: PlanKpis): string {
  if (!k.hasDebt) return "Aucune dette";
  return k.debtFreeMonth ? formatMonthLong(k.debtFreeMonth) : "Au-delà de 25 ans";
}

/** Debt ratio display: "—" when income is 0 (SPEC D10). */
export function debtAlertText(k: PlanKpis): string {
  return k.monthlyIncome === 0 ? "—" : DEBT_ALERT_LABEL[k.debtAlert];
}
