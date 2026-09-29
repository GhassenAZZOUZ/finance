/**
 * Simulator ("Et si…", issue #2): inputs update the simulated column only, invalid inputs keep
 * the last valid results, "Reprendre le plan actuel" resets, and nothing is ever written.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, cloneElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SimulationBase, simulationBase } from "@/app/(app)/simuler/logic";
import { Simulator } from "@/app/(app)/simuler/simulator";
import type { BudgetLine } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot, primaryGoal } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
// jsdom has no layout: give the charts a fixed size instead of measuring their container.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
    cloneElement(children, { width: 800, height: 256 }),
}));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));

const line = (id: string, category: BudgetLine["category"], label: string, amount: number): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const SNAPSHOT = makeSnapshot({
  settings: makeSettings({ startMonth: "2027-01", riskFreeRate: 0.03, earlyRepaymentPct: 0.5 }),
  goals: [primaryGoal({ deadlineMonth: "2027-12" })],
  lines: [line("salary", "income", "Salaire", 300_000), line("rent", "fixed", "Loyer", 120_000), line("food", "variable", "Courses", 40_000)],
  loans: [makeLoan(1, { name: "Prêt auto", apr: 0.06 }), makeLoan(2, { name: "Prêt perso", principal: 300_000, apr: 0.04, monthlyPayment: 15_000 })],
});
const BASE = simulationBase(SNAPSHOT, "2027-01") as SimulationBase;

/** Text with the non-breaking spaces of the French number format normalised. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

function comparisonRow(label: string) {
  const table = screen.getByRole("table", { name: "Comparaison entre le plan actuel et la simulation" });
  const header = within(table).getByRole("rowheader", { name: label });
  const cells = within(header.closest("tr")!).getAllByRole("cell");
  return { current: plain(cells[0]?.textContent), simulated: plain(cells[1]?.textContent), difference: plain(cells[2]?.textContent) };
}

function renderSimulator() {
  render(<Simulator base={BASE} currentMonth="2027-01" />);
  return userEvent.setup();
}

async function retype(user: ReturnType<typeof userEvent.setup>, input: HTMLElement, value: string) {
  await user.clear(input);
  if (value) await user.type(input, value);
}

beforeEach(() => {
  mocks.repo = createRepositoryMock(SNAPSHOT);
  mocks.notify.mockClear();
});
afterEach(cleanup);

describe("Simulator", () => {
  it("opens with the saved values and a simulation identical to the plan (AC-01)", () => {
    renderSimulator();
    expect((screen.getByLabelText("Remboursement anticipé (% du reste)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Taux seuil (%)") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Courses (€ / mois)") as HTMLInputElement).value).toBe("400,00");
    expect(screen.getByText("La simulation est identique à votre plan. Modifiez une hypothèse pour comparer.")).toBeTruthy();
    for (const label of ["Sans dette en", "Intérêts économisés", "Objectif « Déménagement »", "Fonds d’urgence complet en", "Épargne libre à 12 mois"]) {
      expect(comparisonRow(label).difference).toBe("Identique");
    }
  });

  it("updates only the simulated column when the early-repayment % changes (AC-02, AC-04)", async () => {
    const user = renderSimulator();
    const before = comparisonRow("Sans dette en");
    await retype(user, screen.getByLabelText("Remboursement anticipé (% du reste)"), "80");

    const after = comparisonRow("Sans dette en");
    expect(after.current).toBe(before.current);
    expect(after.simulated).not.toBe(before.simulated);
    expect(after.difference).toMatch(/^\d+ mois plus tôt ?\(mieux\)$/);
    expect(comparisonRow("Intérêts économisés").difference).toMatch(/^\+.+ € ?\(mieux\)$/);
    expect(screen.queryByText(/La simulation est identique/)).toBeNull();
  });

  it("shows a French error for an invalid value and keeps the last valid results (AC-07)", async () => {
    const user = renderSimulator();
    const input = screen.getByLabelText("Remboursement anticipé (% du reste)");
    await retype(user, input, "80");
    const valid = comparisonRow("Sans dette en");

    // "80" → "800": every keystroke is applied, so the last valid value is 80 %.
    await user.type(input, "0");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Le taux doit être inférieur ou égal à 100 %")).toBeTruthy();
    expect(screen.getByText("Certaines valeurs sont invalides : la simulation garde les dernières valeurs valides.")).toBeTruthy();
    expect(comparisonRow("Sans dette en")).toEqual(valid);
  });

  it("applies an extra repayment and refuses a negative amount (AC-03, AC-07)", async () => {
    const user = renderSimulator();
    await user.click(screen.getByRole("button", { name: "Ajouter un remboursement" }));
    const group = screen.getByRole("group", { name: "Remboursement 1" });
    expect((within(group).getByLabelText("Crédit") as HTMLSelectElement).value).toBe("loan-1");
    expect(within(group).getByText("Montant requis")).toBeTruthy();

    await user.click(within(group).getByLabelText("Argent en plus (prime, cadeau…)"));
    await retype(user, within(group).getByLabelText("Montant (€)"), "2000");
    expect(within(group).queryByText("Montant requis")).toBeNull();
    expect(comparisonRow("Intérêts économisés").difference).toMatch(/\(mieux\)$/);
    const withExtra = comparisonRow("Intérêts économisés");

    await retype(user, within(group).getByLabelText("Montant (€)"), "-5");
    expect(within(group).getByText("Le montant ne peut pas être négatif")).toBeTruthy();
    expect(comparisonRow("Intérêts économisés")).toEqual(withExtra);

    await user.click(within(group).getByRole("button", { name: "Retirer le remboursement 1" }));
    expect(screen.queryByRole("group", { name: "Remboursement 1" })).toBeNull();
    expect(comparisonRow("Intérêts économisés").difference).toBe("Identique");
  });

  it("changes a budget line in the simulation only (AC-09)", async () => {
    const user = renderSimulator();
    await retype(user, screen.getByLabelText("Courses (€ / mois)"), "300");
    expect(comparisonRow("Épargne libre à 12 mois").difference).toMatch(/^\+.+ € ?\(mieux\)$/);
    expect(screen.getByText(/Plan actuel : 400,00/)).toBeTruthy();
  });

  it("'Reprendre le plan actuel' restores every saved value (AC-06)", async () => {
    const user = renderSimulator();
    const reset = screen.getByRole("button", { name: "Reprendre le plan actuel" });
    expect(reset).toHaveProperty("disabled", true);

    await retype(user, screen.getByLabelText("Remboursement anticipé (% du reste)"), "150");
    await retype(user, screen.getByLabelText("Taux seuil (%)"), "1");
    await user.click(screen.getByRole("button", { name: "Ajouter un remboursement" }));
    await user.click(reset);

    expect((screen.getByLabelText("Remboursement anticipé (% du reste)") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Taux seuil (%)") as HTMLInputElement).value).toBe("3");
    expect(screen.queryByRole("group", { name: "Remboursement 1" })).toBeNull();
    expect(screen.queryByText("Le taux doit être inférieur ou égal à 100 %")).toBeNull();
    expect(comparisonRow("Sans dette en").difference).toBe("Identique");
    expect(reset).toHaveProperty("disabled", true);
  });

  it("never writes anything during a simulation (AC-05)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = renderSimulator();
    await retype(user, screen.getByLabelText("Remboursement anticipé (% du reste)"), "100");
    await retype(user, screen.getByLabelText("Courses (€ / mois)"), "0");
    await user.click(screen.getByRole("button", { name: "Ajouter un remboursement" }));
    await retype(user, screen.getByLabelText("Montant (€)"), "1000");
    await user.click(screen.getByRole("button", { name: "Reprendre le plan actuel" }));

    for (const method of Object.values(mocks.repo!)) expect(method).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("shows both scenarios in the charts with a legend and a data table (AC-08)", () => {
    renderSimulator();
    const legends = screen.getAllByRole("list", { name: "Légende" });
    expect(legends).toHaveLength(2);
    for (const legend of legends) {
      expect(within(legend).getAllByRole("listitem").map((li) => plain(li.textContent))).toEqual(["Plan actuel", "Simulation"]);
    }
    expect(screen.getAllByText("Voir les données")).toHaveLength(2);
    expect(screen.getByRole("img", { name: /^Dette restante sur \d+ mois\./ })).toBeTruthy();
  });
});
