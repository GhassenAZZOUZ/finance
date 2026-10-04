/** Plan page range (issue #76): 1, 3, 6 or 12 months besides 18 months, 5 and 25 years, kept in the URL. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanView } from "@/app/(app)/plan/view";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine } from "@/lib/domain/types";
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
const SNAPSHOT = makeSnapshot({
  settings: makeSettings({ startMonth: "2026-10" }),
  lines: [line("salary", "income", 300_000), line("rent", "fixed", 90_000)],
});
const PLAN = computePlan(SNAPSHOT, "2026-10")!;

const mocks = vi.hoisted(() => ({ mois: null as string | null, replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.mois ? { mois: mocks.mois } : {}),
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: SNAPSHOT, plan: PLAN }) }));

function renderPlan(mois: string | null) {
  mocks.mois = mois;
  render(<PlanView />);
  return userEvent.setup();
}
const table = () => screen.getByRole("table");
/** Month rows (the year separator rows are row headers too). */
const monthRows = () => within(table()).getAllByRole("rowheader").filter((th) => !/^\d{4}/.test(th.textContent ?? ""));

beforeEach(() => mocks.replace.mockReset());
afterEach(cleanup);

describe("Plan page range", () => {
  it("offers 1, 3, 6 and 12 months before the existing choices", () => {
    renderPlan(null);
    const links = within(screen.getByRole("navigation", { name: "Période affichée" })).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["1 mois", "3 mois", "6 mois", "12 mois", "18 mois", "5 ans", "25 ans"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["1", "3", "6", "12", "18", "60", "300"].map((n) => `/plan?mois=${n}`));
    // Default unchanged: 18 months.
    expect(links[4]!.getAttribute("aria-current")).toBe("true");
  });

  it.each([
    ["1", ["oct."], "3 mois"],
    ["3", ["oct.", "nov.", "déc."], "6 mois"],
  ])("?mois=%s shows those months only, and « Afficher » goes to the next choice", (mois, names, next) => {
    renderPlan(mois);
    const rows = monthRows().map((th) => th.textContent ?? "");
    expect(rows.map((r) => r.slice(0, 4).trim())).toEqual(names);
    expect(table().querySelector("caption")?.textContent).toContain(`${names.length} mois à partir de octobre 2026`);
    expect(screen.getByRole("link", { name: `Afficher ${next}` }).getAttribute("href")).toContain(`mois=${next.split(" ")[0]}`);
    expect(within(screen.getByRole("navigation", { name: "Période affichée" })).getByRole("link", { name: `${mois} mois` }).getAttribute("aria-current")).toBe("true");
  });

  it("?mois=12 shows October 2026 to September 2027 and offers 18 months next", () => {
    renderPlan("12");
    expect(monthRows()).toHaveLength(12);
    expect(monthRows().at(-1)!.textContent).toMatch(/^sept\./);
    expect(screen.getByRole("link", { name: "Afficher 18 mois" })).toBeTruthy();
  });

  it("falls back to 18 months for an unknown value", () => {
    renderPlan("7");
    expect(monthRows()).toHaveLength(18);
  });

  it("offers the same choices in a select on phones, which updates the URL", async () => {
    const user = renderPlan("6");
    const select = screen.getByRole("combobox", { name: "Période affichée" }) as HTMLSelectElement;
    expect(select.value).toBe("6");
    await user.selectOptions(select, "12");
    expect(mocks.replace).toHaveBeenCalledWith("/plan?mois=12", { scroll: false });
  });

  it.each([
    ["1", 1, "Le premier mois est affiché ci-dessous."],
    ["12", 12, "Les 12 premiers mois sont affichés ci-dessous."],
    [null, 18, "Les 18 premiers mois sont affichés ci-dessous."],
  ])("AC-05 — ?mois=%s: the overview bracket and its text follow the choice", (mois, count, text) => {
    renderPlan(mois);
    const overview = screen.getByRole("region", { name: "Les 300 mois du plan" });
    const bar = within(overview).getByRole("img");
    expect(bar.getAttribute("aria-label")?.endsWith(`. ${text}`)).toBe(true);
    const bracket = bar.querySelector<HTMLElement>("[aria-hidden].border-foreground")!;
    const width = Number(bracket.style.width.match(/^calc\(([\d.]+)% \+ 4px\)$/)?.[1]);
    expect(width).toBeCloseTo((count / 300) * 100, 4);
    expect(table().querySelector("caption")?.textContent).toContain(`${count} mois à partir de octobre 2026`);
  });
});
