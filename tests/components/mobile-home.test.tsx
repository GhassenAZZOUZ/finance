/** Mobile home (issue #109): margin card, check-in shortcut, KPI cards, moving-fund fixes, next steps. */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileHome } from "@/app/(app)/_dashboard/mobile-home";
import { monthPill } from "@/components/app/nav";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine } from "@/lib/domain/types";
import { makeLoan, makeSettings, makeSnapshot, primaryGoal } from "./helpers";

vi.mock("@/components/app/finance-provider", () => ({ useOptionalFinance: () => null, useFinance: () => null }));

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
/** AC-01's example: 2 900 € in, 1 725 € of expenses, 731,45 € of loan payments. */
const snapshot = (goalTarget = 300_000) =>
  makeSnapshot({
    settings: makeSettings({ startMonth: "2026-07", emergencyTarget: 400_000, emergencyExisting: 80_000 }),
    lines: [line("Salaire", "income", 290_000), line("Loyer", "fixed", 120_000), line("Courses", "variable", 52_500)],
    loans: [makeLoan(1, { name: "Dette perso A", principal: 150_000, monthlyPayment: 50_000, apr: 0.09 }), makeLoan(2, { name: "Auto", principal: 900_000, monthlyPayment: 23_145, apr: 0.05 })],
    goals: [primaryGoal({ name: "Déménagement", target: goalTarget, deadlineMonth: "2026-12", alreadySaved: 0 })],
  });
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

afterEach(cleanup);

function renderHome(pending: string[] = [], goalTarget?: number) {
  const plan = computePlan(snapshot(goalTarget), "2026-09")!;
  render(<MobileHome plan={plan} pending={pending} />);
  return plan;
}

describe("MobileHome", () => {
  it("AC-01 — the margin card shows the reference month's margin and its 3 figures", () => {
    renderHome();
    const card = screen.getByRole("region", { name: "Marge du mois" });
    expect(plain(card.textContent)).toContain("Marge de septembre");
    expect(plain(card.textContent)).toContain("443,55 €");
    expect(plain(card.textContent)).toContain("2 900 €revenus");
    expect(plain(card.textContent)).toContain("1 725 €dépenses");
    expect(plain(card.textContent)).toContain("731,45 €crédits");
    expect(plain(card.textContent)).toMatch(/Endettement 25,2 % · OK/);
  });

  it("AC-02 — the check-in shortcut appears only when months are pending", () => {
    renderHome(["2026-08", "2026-09"]);
    const link = screen.getByRole("link", { name: /Saisir août 2026/ });
    expect(link.getAttribute("href")).toBe("/suivi?mois=2026-08");
    expect(plain(link.textContent)).toContain("2 mois de suivi en attente");
    cleanup();
    renderHome([]);
    expect(screen.queryByRole("link", { name: /^Saisir/ })).toBeNull();
  });

  it("AC-03 — a moving goal out of reach shows its 2 fixes as buttons to the budget", () => {
    renderHome([], 2_000_000);
    const alert = screen.getByRole("region", { name: /Déménagement : il manquera/ });
    const fixes = within(alert).getAllByRole("link");
    expect(fixes.map((a) => a.getAttribute("href"))).toEqual(["/budget", "/budget"].slice(0, fixes.length));
    expect(plain(fixes[0]!.textContent)).toMatch(/^\+.+ € \/ mois d’ici déc\.$/);
  });

  it("AC-03 — no warning when the moving goal is met", () => {
    renderHome([], 10_000);
    expect(screen.queryByRole("region", { name: /il manquera/ })).toBeNull();
  });

  it("AC-04 — lists at most 4 next milestones with their month, and links to Plan", () => {
    renderHome();
    const steps = screen.getByRole("region", { name: "Prochaines étapes" });
    const items = within(steps).getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    expect(plain(items[0]!.textContent)).toMatch(/[a-zéû]+\.? 20\d\d$/);
    expect(within(steps).getByRole("link", { name: "Plan" }).getAttribute("href")).toBe("/plan");
  });

  it("AC-05 — no chart on the mobile home; the KPI cards are a list", () => {
    const { container } = render(<MobileHome plan={computePlan(snapshot(), "2026-09")!} pending={[]} />);
    expect(container.querySelector(".recharts-wrapper, svg.recharts-surface")).toBeNull();
    const kpis = screen.getByRole("list", { name: "Chiffres clés" });
    expect(within(kpis).getAllByRole("listitem").map((li) => plain(li.textContent).split(/\d/)[0]!.trim())).toEqual([
      "Dettes",
      "Épargne",
      "Intérêts évités",
    ]);
    expect(within(kpis).getByRole("link", { name: /Dettes/ }).getAttribute("href")).toBe("/credits");
  });

  it("the header pill names the reference month and its rank in the plan", () => {
    expect(monthPill(computePlan(snapshot(), "2026-09")!)).toBe("Sept. 2026 · mois 3");
  });
});
