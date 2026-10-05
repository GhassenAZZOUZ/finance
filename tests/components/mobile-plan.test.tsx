/** Mobile Plan (issue #113): month cards with allocation bar, breakdown, range chips, year headers, folding. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanView } from "@/app/(app)/plan/view";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine } from "@/lib/domain/types";
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
const SNAPSHOT = makeSnapshot({
  settings: makeSettings({ startMonth: "2026-07" }),
  lines: [line("salary", "income", 300_000), line("rent", "fixed", 90_000)],
  loans: [makeLoan(1, { name: "Auto", principal: 300_000, apr: 0.08, monthlyPayment: 20_000 })],
});
const PLAN = computePlan(SNAPSHOT, "2026-09")!;

const mocks = vi.hoisted(() => ({ mois: null as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.mois ? { mois: mocks.mois } : {}),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: SNAPSHOT, plan: PLAN }) }));

function phone(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: () => {}, removeEventListener: () => {} }) as never;
}

function renderPlan(mois: string | null = null) {
  mocks.mois = mois;
  render(<PlanView />);
  return userEvent.setup({ delay: null });
}

const card = (name: string) => screen.getByRole("listitem", { name });
/** Months listed: the cards plus the months folded into « identiques » rows. */
function listedMonths(): number {
  const cards = screen.getAllByRole("button", { expanded: false }).length + screen.queryAllByRole("button", { expanded: true }).length;
  const folded = screen.queryAllByText(/identiques à/).reduce((n, el) => {
    const m = /^(\S+) à (\S+) (\d{4})/.exec(el.textContent ?? "");
    const order = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    return m ? n + order.indexOf(m[2]!) - order.indexOf(m[1]!.toLowerCase()) + 1 : n;
  }, 0);
  return cards + folded;
}

beforeEach(() => phone(true));
afterEach(() => {
  cleanup();
  phone(false);
});

describe("MobilePlan", () => {
  it("AC-01: one card per month with its event, available amount, allocation bar and summary line", () => {
    renderPlan();
    expect(screen.queryByRole("table")).toBeNull();
    const today = card("septembre 2026");
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(within(today).getByText("Aujourd’hui")).toBeTruthy();
    // September is in the emergency-fund phase here: the bar is all « Urgence », the line its cumul.
    expect(today.textContent).toContain("Disponible");
    expect(within(today).getByRole("img").getAttribute("aria-label")).toMatch(/^Urgence \d/);
    expect(today.textContent).toMatch(/Urgence [\d\s]+,\d\d\s€ · Dettes \d/);
  });

  it("AC-02: tapping a month shows its breakdown, tapping again hides it", async () => {
    const user = renderPlan();
    const july = card("juillet 2026");
    const toggle = within(july).getByRole("button");
    const details = july.querySelector("dl")!;
    expect(details.hidden).toBe(true);
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details.hidden).toBe(false);
    for (const label of ["Revenus", "Dépenses", "Mensualités", "Disponible", "② Fonds d’urgence", "③ Remboursement anticipé", "Épargne libre"]) {
      expect(within(details).getByText(label)).toBeTruthy();
    }
    await user.click(toggle);
    expect(details.hidden).toBe(true);
  });

  it("AC-03: the range chips keep the desktop ?mois= param and list that many months", () => {
    renderPlan("60");
    const links = within(screen.getByRole("navigation", { name: "Période affichée" })).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["18 mois", "5 ans", "25 ans"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/plan?mois=18", "/plan?mois=60", "/plan?mois=300"]);
    expect(links[1]!.getAttribute("aria-current")).toBe("true");
    expect(listedMonths()).toBe(60);
    expect(screen.getByRole("heading", { level: 2, name: /^2031/ })).toBeTruthy();
  });

  it("AC-04: year headers name the active phases", () => {
    renderPlan();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/^2026 · ① /);
    expect(headings.some((h) => /, puis /.test(h ?? ""))).toBe(true);
  });

  it("AC-05: identical months are folded and can be shown", async () => {
    const user = renderPlan("300");
    const folded = screen.getAllByText(/identiques à/);
    expect(folded.length).toBeGreaterThan(0);
    const before = listedMonths();
    await user.click(within(folded[0]!.closest("li")!).getByRole("button", { name: /^Afficher/ }));
    expect(screen.getAllByText(/identiques à/).length).toBe(folded.length - 1);
    expect(listedMonths()).toBe(before);
  });

  it("keeps the desktop table on a wide window", () => {
    phone(false);
    renderPlan();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
