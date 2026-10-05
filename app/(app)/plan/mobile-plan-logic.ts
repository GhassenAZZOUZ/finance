/**
 * Pure helpers of the phone /plan (#113): month events, phase per year, collapsed identical months.
 * No React, unit-tested in tests/unit/mobile-plan.test.ts.
 */
import type { Cents, PlanMonth } from "@/lib/engine";
import type { PhaseKind, PlanPhase } from "../_dashboard/logic";
import type { PlanMilestones } from "./milestones";

export type MonthEventKind = "today" | "negative" | "payoff" | "debtFree" | "deadline" | "goals" | "emergency" | "income" | "expense";

export interface MonthEvent {
  kind: MonthEventKind;
  label: string;
}

/** Chips of a month card, in the desktop table's order. */
export function monthEvents(
  m: PlanMonth,
  milestones: PlanMilestones,
  todayIndex: number,
  names: { goals: string; primary: string },
): MonthEvent[] {
  const events: MonthEvent[] = [];
  if (m.index === todayIndex) events.push({ kind: "today", label: "Aujourd’hui" });
  if (m.negativeBudget) events.push({ kind: "negative", label: "Budget négatif" });
  for (const name of milestones.loanPayoffs.get(m.index) ?? []) events.push({ kind: "payoff", label: `${name} soldé` });
  if (milestones.debtFreeIndex === m.index) events.push({ kind: "debtFree", label: "Plus de dettes" });
  if (milestones.deadlineIndex === m.index) events.push({ kind: "deadline", label: `Date limite ${names.primary.toLocaleLowerCase("fr")}` });
  if (milestones.movingIndex === m.index) {
    events.push({ kind: "goals", label: names.goals === "Objectifs" ? "Objectifs financés" : `${names.goals} financé` });
  }
  if (milestones.emergencyIndex === m.index) events.push({ kind: "emergency", label: "Fonds complet" });
  if (m.extraIncome > 0) events.push({ kind: "income", label: "Revenu exceptionnel" });
  if (m.extraExpenses > 0) events.push({ kind: "expense", label: "Dépense exceptionnelle" });
  return events;
}

/** The four parts of the allocation bar; they add up to the available amount when it is positive. */
export function allocationParts(m: PlanMonth): { moving: Cents; emergency: Cents; repay: Cents; free: Cents } {
  return {
    moving: m.toMoving,
    emergency: m.toEmergency,
    repay: m.toEarlyRepayment - m.unusedEarlyRepayment,
    free: m.toFreeSavings,
  };
}

/** Phase of a plan month (1-based index). */
export function phaseAt(phases: readonly PlanPhase[], index: number): PhaseKind {
  return phases.find((p) => index >= p.startIndex && index <= p.endIndex)?.kind ?? "free";
}

const SHORT_PHASE: Record<PhaseKind, (goals: string, pct: number) => string> = {
  moving: (goals) => `① ${goals}`,
  emergency: () => "② urgence",
  repay: (_, pct) => (pct > 0 ? "③ remboursement" : "③ épargne"),
  free: () => "④ épargne libre",
};

/** « ① Déménagement », « ② Urgence, puis ③ remboursement »: the phases met in a year's months. */
export function yearPhaseLabel(months: readonly PlanMonth[], phases: readonly PlanPhase[], goals: string, pct: number): string {
  const kinds: PhaseKind[] = [];
  for (const m of months) {
    const kind = phaseAt(phases, m.index);
    if (kinds.at(-1) !== kind) kinds.push(kind);
  }
  const text = kinds.map((k) => SHORT_PHASE[k](goals, pct)).join(", puis ");
  // Capitalise the first word after the circled digit.
  return text.replace(/^(\S+ )(\p{L})/u, (_, digit: string, letter: string) => digit + letter.toLocaleUpperCase("fr"));
}

/** « Déménagement » → « Déménag. »: the card line is one short row on a phone. */
export function shortName(name: string): string {
  return name.length > 9 ? `${name.slice(0, 7)}.` : name;
}

export interface MonthGroup {
  /** The card shown. */
  head: PlanMonth;
  /** Following months of the same year with the same amounts and no event, collapsed under the head. */
  same: PlanMonth[];
}

const sameAmounts = (a: PlanMonth, b: PlanMonth) => {
  const pa = allocationParts(a);
  const pb = allocationParts(b);
  return a.available === b.available && pa.moving === pb.moving && pa.emergency === pb.emergency && pa.repay === pb.repay && pa.free === pb.free;
};

/**
 * Consecutive months are « identical » when they have the same available amount and the same
 * allocations, with no event in between (#113 decision); groups stay inside a calendar year.
 */
export function groupIdentical(months: readonly PlanMonth[], hasEvent: (m: PlanMonth) => boolean): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const m of months) {
    const last = groups.at(-1);
    if (last && !hasEvent(m) && last.head.month.slice(0, 4) === m.month.slice(0, 4) && sameAmounts(last.head, m)) {
      last.same.push(m);
    } else {
      groups.push({ head: m, same: [] });
    }
  }
  return groups;
}
