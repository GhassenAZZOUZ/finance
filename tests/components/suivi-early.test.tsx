/** Next month opens with its first income (issue #61): when it opens, preselection and the « to enter » count. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiviView } from "@/app/(app)/suivi/view";
import { usePendingCheckIns } from "@/components/app/nav";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { makeSettings, makeSnapshot } from "./helpers";

const income = (id: string, label: string, paydayDay: number, paydayPreviousMonth: boolean): BudgetLine => ({
  id,
  category: "income",
  label,
  amount: 150_000,
  position: 0,
  startMonth: null,
  endMonth: null,
  paydayDay,
  paydayPreviousMonth,
});
const LINES = [income("a", "Salaire A", 27, true), income("b", "Salaire B", 1, false)];
const september: MonthlyActual = {
  id: "sep",
  month: "2026-09",
  income: null,
  expenses: null,
  lines: [],
  emergencySavings: 0,
  freeSavings: 0,
  goalBalances: [],
  loanBalances: [],
  frozen: null,
} as MonthlyActual;

const mocks = vi.hoisted(() => ({ value: null as { snapshot: FinanceSnapshot; plan: ReturnType<typeof computePlan> } | null }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value, useOptionalFinance: () => mocks.value }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/suivi" }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => ({}), notifyDataChanged: vi.fn() }));

/** Noon in Paris on that day. */
function at(day: string, actuals: MonthlyActual[] = []) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T10:00:00Z`));
  const snapshot = makeSnapshot({ settings: makeSettings({ startMonth: "2026-09" }), lines: LINES, actuals });
  mocks.value = { snapshot, plan: computePlan(snapshot, day.slice(0, 7)) };
}

function Pending() {
  return <p>À saisir : {usePendingCheckIns().join(", ")}</p>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Suivi, next month (#61)", () => {
  it("AC-05 — says when next month opens and when each income is expected", () => {
    at("2026-09-26");
    render(<SuiviView />);
    expect(screen.getByText("Octobre 2026 s’ouvrira au suivi le 27/09/2026 (Salaire A), dès le premier revenu versé.")).toBeTruthy();
    expect(screen.getByText("Attendu le 27/09/2026")).toBeTruthy();
    expect(screen.getByText("Attendu le 01/10/2026")).toBeTruthy();
  });

  it("AC-06 — once the first income is paid, next month is preselected and counted as to enter", () => {
    at("2026-09-28", [september]);
    render(
      <>
        <SuiviView />
        <Pending />
      </>,
    );
    expect(screen.getByRole("button", { name: "Enregistrer octobre 2026" })).toBeTruthy();
    expect(screen.getByText("À saisir : 2026-10")).toBeTruthy();
  });

  it("before the payday, next month is neither open nor counted", () => {
    at("2026-09-26", [september]);
    render(<Pending />);
    expect(screen.getByText(/^À saisir :\s*$/)).toBeTruthy();
  });
});
