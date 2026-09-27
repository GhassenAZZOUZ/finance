/**
 * Plan table markers for one-off exceptions (SPEC D14): which exceptions fall on each plan month.
 * Pure function so it can be unit-tested without rendering.
 */
import type { YearMonth } from "@/lib/engine";
import type { BudgetException } from "@/lib/domain/types";
import { planIndexOf } from "./milestones";

export type ExceptionMarker = Pick<BudgetException, "id" | "label" | "amount">;

export interface MonthExceptions {
  income: readonly ExceptionMarker[];
  expense: readonly ExceptionMarker[];
}

/**
 * Plan month index (1-based) → the exceptions of that month, split by kind, in input order.
 * Exceptions outside the plan (before the start month or after the last simulated month) are
 * dropped: the engine ignores them, so the table shows nothing for them.
 */
export function exceptionsByPlanIndex(
  exceptions: readonly Pick<BudgetException, "id" | "month" | "kind" | "label" | "amount">[],
  startMonth: YearMonth,
  monthCount: number,
): ReadonlyMap<number, MonthExceptions> {
  const byIndex = new Map<number, { income: ExceptionMarker[]; expense: ExceptionMarker[] }>();
  for (const e of exceptions) {
    const index = planIndexOf(e.month, startMonth, monthCount);
    if (index === null) continue;
    let entry = byIndex.get(index);
    if (!entry) {
      entry = { income: [], expense: [] };
      byIndex.set(index, entry);
    }
    entry[e.kind].push({ id: e.id, label: e.label, amount: e.amount });
  }
  return byIndex;
}

