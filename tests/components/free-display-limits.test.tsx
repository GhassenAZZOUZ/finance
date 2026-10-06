/** Free plan display limits (issue #140, owner decision 2026-10-07): plan horizon and history. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanView } from "@/app/(app)/plan/view";
import { SuiviView } from "@/app/(app)/suivi/view";
import { onPaywall } from "@/lib/billing/paywall";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { makeSettings, makeSnapshot } from "./helpers";

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const actual = (month: string): MonthlyActual =>
  ({ id: month, month, income: null, expenses: null, lines: [], emergencySavings: 0, freeSavings: 0, goalBalances: [], loanBalances: [], frozen: null }) as MonthlyActual;

const mocks = vi.hoisted(() => ({ mois: "60" as string | null, value: null as unknown }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.mois ? { mois: mocks.mois } : {}),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/plan",
}));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value, useOptionalFinance: () => mocks.value }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => ({}), notifyDataChanged: vi.fn() }));

function setup(isPro: boolean | undefined, actuals: MonthlyActual[] = []) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-15T10:00:00Z"));
  const snapshot: FinanceSnapshot = makeSnapshot({
    settings: makeSettings({ startMonth: "2026-07" }),
    lines: [line("salary", "income", 300_000), line("rent", "fixed", 90_000)],
    actuals,
    isPro,
  });
  mocks.value = { snapshot, plan: computePlan(snapshot, "2026-12") };
}

const opened = vi.fn();
let off: () => void;
beforeEach(() => {
  opened.mockReset();
  off = onPaywall(opened);
});
afterEach(() => {
  off();
  cleanup();
  vi.useRealTimers();
});

const monthRows = () => within(screen.getByRole("table")).getAllByRole("rowheader").filter((th) => !/^\d{4}/.test(th.textContent ?? ""));

describe("Plan, Free plan", () => {
  it("shows 3 months even when more are asked, and the longer ranges open the paywall", async () => {
    setup(false);
    render(<PlanView />);
    expect(monthRows()).toHaveLength(3);
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "5 ans (Boussole Pro)" }));
    expect(opened).toHaveBeenLastCalledWith("plan_limit");
    await user.click(screen.getByRole("button", { name: /Afficher la suite/ }));
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("Pro (or unknown) sees the range asked", () => {
    setup(true);
    render(<PlanView />);
    expect(monthRows()).toHaveLength(60);
    expect(screen.queryByRole("button", { name: /Boussole Pro/ })).toBeNull();
  });
});

describe("Suivi history, Free plan", () => {
  const actuals = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map(actual);

  it("shows the last 3 months; the older ones are counted and open the paywall", async () => {
    setup(false, actuals);
    render(<SuiviView />);
    const history = screen.getByRole("region", { name: "Historique" });
    expect(history.textContent).not.toMatch(/juillet 2026|août 2026|septembre 2026/i);
    expect(history.textContent).toMatch(/octobre 2026/i);
    expect(screen.getByText(/3 mois plus anciens : enregistrés, visibles avec Boussole Pro\./)).toBeTruthy();
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Voir tout l’historique" }));
    expect(opened).toHaveBeenCalledWith("history_limit");
  });

  it("Pro sees every month", () => {
    setup(true, actuals);
    render(<SuiviView />);
    expect(screen.queryByText(/plus anciens/)).toBeNull();
  });
});
