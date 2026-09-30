/**
 * « Plan tenu » verdict of a monthly check-in (issue #74, SPEC D34): did I do what the plan said this
 * month? Three checks with the ±10 € tolerance of §8.2, all from the check-in itself: its rows (#72)
 * and deposits (#73) carry the month's planned amounts frozen at save time, so a later budget change
 * or re-base never rewrites a past verdict.
 */
import { type Cents, GAP_TOLERANCE, sumCents } from "@/lib/engine";
import type { ActualLine } from "./actual-lines";
import type { SavingsDeposit } from "./deposits";

export type VerdictKind = "held" | "partial" | "missed";

export interface VerdictCheck {
  actual: Cents;
  planned: Cents;
  /** actual − planned. */
  gap: Cents;
  ok: boolean;
}

export interface Verdict {
  kind: VerdictKind;
  expenses: VerdictCheck;
  income: VerdictCheck;
  savings: VerdictCheck;
  /** Up to 3 budget lines overspent by more than 10 €, the largest first. */
  overspent: { label: string; gap: Cents }[];
  /** Pots whose deposit fell short of the plan's by more than 10 €. */
  missedPots: { label: string; gap: Cents }[];
}

export const VERDICT_LABEL: Record<VerdictKind, string> = {
  held: "Plan tenu",
  partial: "Plan partiellement tenu",
  missed: "Plan non tenu",
};

const POT_LABEL = { emergency: "Fonds d’urgence", free: "Épargne libre" } as const;

/** The check-in's rows and deposits: what the verdict reads. */
export interface VerdictInput {
  lines: readonly ActualLine[];
  deposits?: readonly SavingsDeposit[];
}

/** « — (non détaillé) »: a check-in saved before the per-line rows (#72) or the deposits (#73) has no verdict. */
export function isDetailed(input: VerdictInput): boolean {
  return input.lines.length > 0 && (input.deposits?.length ?? 0) > 0;
}

function check(actual: Cents, planned: Cents, spend: boolean): VerdictCheck {
  const gap = actual - planned;
  return { actual, planned, gap, ok: spend ? gap <= GAP_TOLERANCE : gap >= -GAP_TOLERANCE };
}

/** The verdict of a check-in, or null when it is not detailed. */
export function verdictOf(input: VerdictInput): Verdict | null {
  if (!isDetailed(input)) return null;
  const sum = (lines: readonly ActualLine[], pick: (l: ActualLine) => Cents) => sumCents(lines.map(pick));
  const incomeRows = input.lines.filter((l) => l.direction === "income");
  const expenseRows = input.lines.filter((l) => l.direction === "expense");
  const deposits = input.deposits ?? [];
  const expenses = check(sum(expenseRows, (l) => l.actual), sum(expenseRows, (l) => l.planned), true);
  const income = check(sum(incomeRows, (l) => l.actual), sum(incomeRows, (l) => l.planned), false);
  const savings = check(sumCents(deposits.map((d) => d.amount)), sumCents(deposits.map((d) => d.planned)), false);
  const held = [expenses, income, savings].filter((c) => c.ok).length;
  return {
    kind: held === 3 ? "held" : held === 0 ? "missed" : "partial",
    expenses,
    income,
    savings,
    overspent: expenseRows
      .map((l) => ({ label: l.label, gap: l.actual - l.planned }))
      .filter((l) => l.gap > GAP_TOLERANCE)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3),
    missedPots: deposits
      .map((d) => ({ label: d.pot === "goal" ? (d.goalName ?? "Objectif") : POT_LABEL[d.pot], gap: d.amount - d.planned }))
      .filter((d) => d.gap < -GAP_TOLERANCE),
  };
}
