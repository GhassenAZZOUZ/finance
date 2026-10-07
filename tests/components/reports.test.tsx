/** Pro reports page (issue #145). Invented data only. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsView } from "@/app/(app)/rapports/reports-view";
import { onPaywall } from "@/lib/billing/paywall";
import { RepositoryError } from "@/lib/data/repository";
import type { ActualLine } from "@/lib/domain/actual-lines";
import type { BudgetLine, FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ value: null as unknown, repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));
vi.mock("@/lib/errors", async (original) => ({ ...(await original<typeof import("@/lib/errors")>()), reportError: vi.fn() }));

const line = (id: string, category: BudgetLine["category"], label: string, tag?: string): BudgetLine => ({
  id,
  category,
  label,
  amount: 0,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...(tag ? { tag } : {}),
});
const row = (id: string, label: string, planned: number, actual: number): ActualLine => ({
  kind: "line",
  direction: "expense",
  category: "variable",
  budgetLineId: id,
  exceptionId: null,
  label,
  planned,
  actual,
});
const checkIn = (month: string, lines: ActualLine[]) =>
  ({ id: month, month, income: null, expenses: null, lines, emergencySavings: 0, freeSavings: 0, goalBalances: [], loanBalances: [], frozen: null }) as MonthlyActual;

function setup(isPro: boolean) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-03-15T10:00:00Z"));
  const snapshot: FinanceSnapshot = makeSnapshot({
    lines: [line("food", "variable", "Courses", "Alimentation"), line("leisure", "variable", "Sorties")],
    actuals: ["2027-01", "2027-02", "2027-03"].map((m) => checkIn(m, [row("food", "Courses", 40_000, 46_000), row("leisure", "Sorties", 10_000, 9_000)])),
    isPro,
  });
  mocks.value = { snapshot };
  mocks.repo = createRepositoryMock();
  render(<ReportsView />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => mocks.notify.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ReportsView", () => {
  it("Free: one locked card that opens the paywall, no report", async () => {
    const opened = vi.fn();
    const off = onPaywall(opened);
    const user = setup(false);
    expect(screen.getByText("Réservé à Boussole Pro")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Découvrir Boussole Pro" }));
    expect(opened).toHaveBeenCalledWith("tags_limit");
    off();
  });

  it("Pro: recurring overspends, totals per tag, and 12 months per line", () => {
    setup(true);
    expect(within(screen.getByRole("region", { name: "Dépassements récurrents" })).getByText(/Courses : au-dessus du budget 3 mois sur 12/)).toBeTruthy();
    const tags = within(screen.getByRole("region", { name: "Dépenses par étiquette sur 12 mois" }));
    expect(tags.getByRole("row", { name: /Alimentation/ }).textContent).toMatch(/1\s200,00\s€.*1\s380,00\s€/);
    expect(tags.getByRole("row", { name: /Sans étiquette/ })).toBeTruthy();
    const lines = screen.getByRole("region", { name: /Réel par ligne et par mois/ });
    expect(within(lines).getAllByRole("columnheader")).toHaveLength(15);
    expect(within(lines).getByRole("row", { name: /Courses/ }).textContent).toContain("dépassement récurrent");
    const months = within(screen.getByRole("region", { name: "Rapport mensuel (PDF)" })).getAllByRole("link");
    // Next.js keeps the trailing slash in the build (trailingSlash) but not in tests.
    expect(months.map((l) => l.getAttribute("href")?.replace("/rapports/mois/", "/rapports/mois"))).toEqual([
      "/rapports/mois?mois=2027-03",
      "/rapports/mois?mois=2027-02",
      "/rapports/mois?mois=2027-01",
    ]);
  });

  it("filters the lines by tag", async () => {
    const user = setup(true);
    await user.selectOptions(screen.getByLabelText("Étiquette"), "Alimentation");
    const lines = screen.getByRole("region", { name: /Réel par ligne et par mois/ });
    expect(within(lines).queryByRole("row", { name: /Sorties/ })).toBeNull();
    expect(within(lines).getByRole("row", { name: /Courses/ })).toBeTruthy();
  });

  it("saves a line's tag, and shows the refusal of the database", async () => {
    const user = setup(true);
    const input = screen.getByLabelText("Sorties");
    await user.type(input, "Loisirs");
    await user.click(screen.getByRole("button", { name: "Enregistrer l’étiquette de « Sorties »" }));
    expect(mocks.repo!.setLineTag).toHaveBeenCalledWith("leisure", "Loisirs");
    expect(await screen.findByText("« Sorties » : Loisirs")).toBeTruthy();
    expect(mocks.notify).toHaveBeenCalled();

    mocks.repo!.setLineTag.mockRejectedValueOnce(new RepositoryError("tags_limit", "PT402"));
    await user.click(screen.getByRole("button", { name: "Enregistrer l’étiquette de « Courses »" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Les étiquettes et les rapports sont réservés à Boussole Pro."));
  });
});

describe("ReportsView, explanations", () => {
  it("points to the tags section while no line has a tag", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-15T10:00:00Z"));
    mocks.repo = createRepositoryMock();
    mocks.value = {
      snapshot: makeSnapshot({
        lines: [line("food", "variable", "Courses")],
        actuals: [checkIn("2027-03", [row("food", "Courses", 40_000, 41_000)])],
        isPro: true,
      }),
    };
    render(<ReportsView />);
    const tags = screen.getByRole("region", { name: "Dépenses par étiquette" });
    expect(within(tags).getByText(/Aucune ligne n’a encore d’étiquette/)).toBeTruthy();
    expect(within(tags).getByRole("link", { name: "Étiquettes des lignes" }).getAttribute("href")).toBe("#report-line-tags-title");
  });
});
