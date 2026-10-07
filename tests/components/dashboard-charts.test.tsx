/** Dashboard charts (issues #86–#92): the tabbed plan card, where income goes, and the « Suivi » row. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TooltipContentProps } from "recharts";
import { StackTooltip, type StackSeries } from "@/app/(app)/_dashboard/plan-stack-chart";
import { DashboardView } from "@/app/(app)/view";
import type { ActualLine } from "@/lib/domain/actual-lines";
import { type ComputedPlan, computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import type { ActualComparison } from "@/lib/engine";
import { makeLoan, makeSettings, makeSnapshot } from "./helpers";

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const SETTINGS = makeSettings({ startMonth: "2026-10" });
const LINES = [line("Salaire", "income", 300_000), line("Loyer", "fixed", 90_000), line("Courses", "variable", 40_000)];

const mocks = vi.hoisted(() => ({ value: null as { snapshot: FinanceSnapshot; plan: ComputedPlan | null } | null }));
vi.mock("@/components/app/finance-provider", () => ({
  useFinance: () => mocks.value,
  useOptionalFinance: () => mocks.value,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

function renderDashboard(snapshot: FinanceSnapshot, patch: Partial<ComputedPlan> = {}) {
  const plan = { ...computePlan(snapshot, "2026-10")!, ...patch };
  mocks.value = { snapshot, plan };
  render(<DashboardView />);
  return userEvent.setup({ delay: null });
}

afterEach(cleanup);

const tabNames = () => within(screen.getByRole("tablist", { name: "Graphiques du plan" })).getAllByRole("tab").map((t) => t.textContent);
const panel = () => screen.getByRole("tabpanel");

describe("Plan charts card (#86, #88, #89, #90)", () => {
  it("offers one tab per view; credit tabs only with loans", () => {
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: [makeLoan(1), makeLoan(2, { name: "Auto", apr: 0.09 })] }));
    expect(tabNames()).toEqual(["Dettes et épargne", "Fonds", "Patrimoine", "Intérêts", "Dettes par crédit"]);
    cleanup();
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES }));
    expect(tabNames()).toEqual(["Dettes et épargne", "Fonds", "Patrimoine"]);
  });

  it("switches panels by click and with the arrow keys", async () => {
    const user = renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: [makeLoan(1)] }));
    expect(screen.getByRole("tab", { name: "Dettes et épargne" }).getAttribute("aria-selected")).toBe("true");

    await user.click(screen.getByRole("tab", { name: "Fonds" }));
    expect(within(panel()).getByRole("img").getAttribute("aria-label")).toMatch(/Déménagement : de .*objectif 3\s000\s€.*Fonds d’urgence/);
    expect(within(within(panel()).getByRole("list", { name: "Légende" })).getByText("Objectif fonds d’urgence")).toBeTruthy();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Patrimoine" })).toBe(document.activeElement);
    expect(within(panel()).getByText(/Patrimoine positif/)).toBeTruthy();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Dettes par crédit" }).getAttribute("aria-selected")).toBe("true");
    expect(within(panel()).getByRole("list", { name: "Fin des crédits" }).textContent).toMatch(/Prêt 1 : soldé en/);

    await user.keyboard("{ArrowLeft}");
    expect(within(panel()).getByRole("img").getAttribute("aria-label")).toMatch(/pénalités comprises/);
  });
});

describe("Where income goes (#87)", () => {
  it("shows 12 months from the reference month, with the income in the table", () => {
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: [makeLoan(1)] }));
    const card = screen.getByRole("region", { name: "Où vont vos revenus, 12 mois" });
    const table = within(card).getByRole("table", { hidden: true });
    expect(within(table).getAllByRole("rowheader", { hidden: true })).toHaveLength(12);
    expect(within(table).getAllByRole("columnheader", { hidden: true }).map((th) => th.textContent)).toContain("Revenus");
    expect(within(card).getByRole("img").getAttribute("aria-label")).toMatch(/^Répartition des revenus sur 12 mois\. octobre 2026 : 3\s000,00\s€ de revenus/);
  });
});

describe("Acceptance details", () => {
  const legend = (container: HTMLElement) => within(container).getByRole("list", { name: "Légende" });

  it("AC-02 (#86) — targets are dashed reference lines", async () => {
    const user = renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES }));
    await user.click(screen.getByRole("tab", { name: "Fonds" }));
    const item = (name: string) => within(legend(panel())).getByText(name).closest("li")!;
    expect(item("Objectif fonds d’urgence").querySelector("line")!.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(item("Objectif Déménagement").querySelector("line")!.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(item("Fonds d’urgence").querySelector("line")!.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("AC-01 / AC-03 (#87) — segments are labelled by use; a negative month gets a « Budget négatif » segment", () => {
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, loans: [makeLoan(1)] }));
    const card = screen.getByRole("region", { name: "Où vont vos revenus, 12 mois" });
    const names = within(legend(card)).getAllByRole("listitem").map((li) => li.textContent);
    expect(names).toEqual(expect.arrayContaining(["Dépenses", "Mensualités", "Déménagement", "Fonds d’urgence"]));
    expect(names).not.toContain("Budget négatif");
    cleanup();

    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: [line("Salaire", "income", 100_000), line("Loyer", "fixed", 150_000)] }));
    const negative = screen.getByRole("region", { name: "Où vont vos revenus, 12 mois" });
    expect(within(legend(negative)).getByText("Budget négatif")).toBeTruthy();
    expect(within(negative).getByRole("img").getAttribute("aria-label")).toContain("Budget négatif en octobre 2026");
  });

  it("AC-04 (#87) — the tooltip lists every non-zero segment in euros, and the income", () => {
    const row = { label: "oct. 2026", expenses: 1300, loanPayments: 200, goals: 1500, emergency: 0, income: 3000 };
    const series: StackSeries[] = [
      { key: "expenses", name: "Dépenses", color: "x", type: "bar", stackId: "uses" },
      { key: "loanPayments", name: "Mensualités", color: "x", type: "bar", stackId: "uses" },
      { key: "goals", name: "Déménagement", color: "x", type: "bar", stackId: "uses" },
      { key: "emergency", name: "Fonds d’urgence", color: "x", type: "bar", stackId: "uses" },
      { key: "income", name: "Revenus", color: "x", type: "bar", tooltipOnly: true },
    ];
    const props = { active: true, label: row.label, payload: [{ payload: row, dataKey: "expenses", value: 1300 }] } as unknown as TooltipContentProps;
    render(<StackTooltip {...props} series={series} signedValues={false} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/\s/g, " "));
    expect(items).toEqual(["3 000,00 €Revenus", "1 500,00 €Déménagement", "200,00 €Mensualités", "1 300,00 €Dépenses"]);
  });
});

describe("Suivi row (#91, #92)", () => {
  it("AC-03 (#91) — invites to enter the first month when nothing is entered", () => {
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES }));
    const card = screen.getByRole("region", { name: "Écarts au plan, mois par mois" });
    expect(within(card).getByRole("link", { name: "Saisir mon premier mois" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Dépenses par poste/ })).toBeNull();
  });

  it("charts the gaps and the latest month's spending by line", () => {
    const comparison = (month: string, incomeGap: number, expensesGap: number) =>
      ({ month, actualDebt: 0, actualSavings: 0, incomeGap, expensesGap }) as ActualComparison;
    const expense = (label: string, planned: number, actual: number): ActualLine => ({
      kind: "line",
      direction: "expense",
      category: "variable",
      budgetLineId: label,
      exceptionId: null,
      label,
      planned,
      actual,
    });
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES }), {
      comparisons: [comparison("2026-10", 0, 7_000)],
      actuals: [{ id: "a", month: "2026-10", lines: [expense("Courses", 40_000, 47_000), expense("Loyer", 90_000, 90_000)] } as unknown as MonthlyActual],
    });

    const gaps = screen.getByRole("region", { name: "Écarts au plan, mois par mois" });
    expect(within(gaps).getByRole("img").getAttribute("aria-label")).toMatch(/dépenses \+70,00\s€\. 1 mois au-delà/);
    expect(within(gaps).getByText("+70,00 € (hors tolérance)", { normalizer: (t) => t.replace(/\s/g, " ") })).toBeTruthy();

    const spending = screen.getByRole("region", { name: "Dépenses par poste, octobre 2026" });
    const rows = within(spending).getAllByRole("rowheader", { hidden: true }).map((th) => th.textContent);
    expect(rows).toEqual(["Courses", "Loyer"]);
    expect(within(spending).getByRole("img").getAttribute("aria-label")).toMatch(/Plus gros dépassement : Courses, \+70,00\s€/);
  });
});

describe("Free plan (#145)", () => {
  it("replaces the projections with one locked card; the key figures stay", async () => {
    const { onPaywall } = await import("@/lib/billing/paywall");
    const opened = vi.fn();
    const off = onPaywall(opened);
    const user = renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, isPro: false }));
    expect(screen.queryByRole("tablist", { name: "Graphiques du plan" })).toBeNull();
    const locked = screen.getByRole("region", { name: "Vos projections sur 2 ans" });
    await user.click(within(locked).getByRole("button", { name: "Découvrir Boussole Pro" }));
    expect(opened).toHaveBeenCalledWith("plan_limit");
    expect(screen.getByRole("region", { name: "Chiffres clés" })).toBeTruthy();
    off();
  });

  it("Pro keeps the charts", () => {
    renderDashboard(makeSnapshot({ settings: SETTINGS, lines: LINES, isPro: true }));
    expect(screen.getByRole("tablist", { name: "Graphiques du plan" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Vos projections sur 2 ans" })).toBeNull();
  });
});
