/**
 * Pure view-model for the one-off exceptions card (SPEC D14): grouping, plan-period checks and
 * form parsing. No React, no I/O, so it is unit-tested (tests/unit/budget-exceptions.test.ts).
 */
import type { BudgetException } from "@/lib/domain/types";
import type { ExceptionForm } from "@/lib/domain/validation";
import { HORIZON_MONTHS, type YearMonth, isYearMonth, monthsBetween } from "@/lib/engine";

export type ExceptionKind = BudgetException["kind"];

export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = {
  income: "Revenu en plus",
  expense: "Dépense en plus",
};

/** Typographic sign shown before the amount (U+2212 minus for expenses). */
export const EXCEPTION_SIGN: Record<ExceptionKind, string> = { income: "+", expense: "−" };

export const EMPTY_EXCEPTION_FORM: ExceptionForm = { month: "", kind: "expense", label: "", amount: "" };

/** Where a month falls relative to the simulated period [start, start + HORIZON_MONTHS). */
export type PlanPeriodStatus = "inside" | "before" | "after";

export function planPeriodStatus(month: YearMonth, startMonth: YearMonth): PlanPeriodStatus {
  const offset = monthsBetween(startMonth, month);
  if (offset < 0) return "before";
  return offset < HORIZON_MONTHS ? "inside" : "after";
}

export interface ExceptionMonthGroup {
  month: YearMonth;
  items: BudgetException[];
  /** False when the month is outside the plan period (the exceptions have no effect). */
  inPlan: boolean;
}

/**
 * Exceptions grouped by month, months in chronological order, entry order kept within a month.
 * Without a plan start (no valid settings yet) every month counts as inside.
 */
export function groupExceptionsByMonth(
  exceptions: readonly BudgetException[],
  startMonth: YearMonth | null,
): ExceptionMonthGroup[] {
  const byMonth = new Map<YearMonth, BudgetException[]>();
  for (const e of exceptions) {
    const items = byMonth.get(e.month);
    if (items) items.push(e);
    else byMonth.set(e.month, [e]);
  }
  return [...byMonth.keys()]
    .sort((a, b) => monthsBetween(b, a))
    .map((month) => ({
      month,
      items: byMonth.get(month) ?? [],
      inPlan: startMonth === null || planPeriodStatus(month, startMonth) === "inside",
    }));
}

/** Number of distinct months, inside the plan period, that carry at least one exception. */
export function affectedMonthCount(exceptions: readonly BudgetException[], startMonth: YearMonth | null): number {
  return groupExceptionsByMonth(exceptions, startMonth).filter((g) => g.inPlan).length;
}

/** Default month of the add form: the plan start, or the current month when there is no plan. */
export function defaultExceptionMonth(startMonth: YearMonth | null, currentMonth: YearMonth): YearMonth {
  return startMonth && isYearMonth(startMonth) ? startMonth : currentMonth;
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Server side: the untrusted form fields, as strings (validateException does the checks). */
export function readExceptionForm(formData: FormData): ExceptionForm {
  return {
    month: text(formData, "month"),
    kind: text(formData, "kind"),
    label: text(formData, "label").slice(0, 200),
    amount: text(formData, "amount").slice(0, 50),
  };
}

/** Server side: the id to delete, or null when missing or malformed. */
export function readExceptionId(formData: FormData): string | null {
  const id = text(formData, "id").trim();
  return id !== "" && id.length <= 100 ? id : null;
}
