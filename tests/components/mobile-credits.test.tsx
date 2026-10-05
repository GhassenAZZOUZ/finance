/** Mobile Crédits (issue #112): totals card, priority cards, compact rows, edit sheet, limit. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditsView } from "@/app/(app)/credits/view";
import { withPlan } from "@/lib/domain/plan";
import type { BudgetLine, Loan } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const line = (id: string, category: BudgetLine["category"], label: string, amount: number): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const mocks = vi.hoisted(() => ({ value: null as unknown, repo: null as RepositoryMock | null }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value, useOptionalFinance: () => mocks.value }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: vi.fn() }));

function phone(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: () => {}, removeEventListener: () => {} }) as never;
}

const revolving = makeLoan(1, { name: "Revolving", apr: 0.189, principal: 300_000, monthlyPayment: 15_000 });
const auto = makeLoan(2, { name: "Auto", apr: 0.059, principal: 600_000, monthlyPayment: 25_000 });
const cheap = makeLoan(3, { name: "Prêt travaux", apr: 0.012, principal: 400_000, monthlyPayment: 20_000 });

function setup(loans: Loan[] = [revolving, auto, cheap], archivedLoans: Loan[] = []) {
  const snapshot = makeSnapshot({
    settings: makeSettings({ startMonth: "2026-07" }),
    lines: [line("salary", "income", "Salaire", 350_000), line("rent", "fixed", "Loyer", 95_000)],
    loans,
    archivedLoans,
  });
  mocks.value = withPlan(snapshot, "2026-09");
  mocks.repo = createRepositoryMock(snapshot);
  render(<CreditsView />);
  return userEvent.setup({ delay: null });
}

beforeEach(() => phone(true));
afterEach(() => {
  cleanup();
  phone(false);
});

describe("MobileCredits", () => {
  it("AC-01: the totals card shows remaining principal, payments, interest avoided and weighted APR", () => {
    setup();
    const totals = screen.getByRole("region", { name: "Totaux" });
    for (const label of ["Capital restant dû", "Mensualités", "Intérêts évités", "TAEG moyen"]) {
      expect(within(totals).getByText(label)).toBeTruthy();
    }
    expect(within(totals).getByText(/600,00/)).toBeTruthy(); // 150 + 250 + 200 € a month
  });

  it("AC-02: eligible loans are cards in priority order with their end month and months gained", () => {
    setup();
    const cards = within(screen.getByRole("region", { name: "Remboursés en priorité" })).getAllByRole("listitem");
    expect(cards[0]!.textContent).toContain("Revolving");
    expect(within(cards[0]!).getByLabelText("Priorité 1")).toBeTruthy();
    expect(cards[0]!.textContent).toMatch(/Soldé en \S+ \d{4}/);
    expect(cards[0]!.textContent).toMatch(/\d+ mois plus tôt/);
    expect(cards[0]!.textContent).toMatch(/18,90\s% · 150,00/);
    expect(within(cards[0]!).getByRole("progressbar")).toBeTruthy();
    expect(cards[1]!.textContent).toContain("Auto");
  });

  it("AC-03: a loan under the threshold is a compact row with its end month and the threshold sentence", () => {
    setup();
    const normal = screen.getByRole("region", { name: "Remboursement normal" });
    expect(within(normal).getByText(/Taux sous le seuil de 3\s%\s: mieux vaut épargner/)).toBeTruthy();
    const row = within(normal).getByRole("listitem");
    expect(row.textContent).toContain("Prêt travaux");
    expect(row.textContent).toMatch(/1,20\s% · fin \S+ \d{4}/);
  });

  it("AC-04: tapping a loan opens its edit sheet; saving uses the existing action and closes it", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Modifier « Revolving »" }));
    const sheet = screen.getByRole("dialog", { name: "Modifier « Revolving »" });
    expect(within(sheet).getByLabelText("Capital restant dû (€)")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Supprimer « Revolving »" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => expect(mocks.repo!.updateLoan).toHaveBeenCalledWith("loan-1", expect.objectContaining({ apr: 0.189 })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the sheet open with the error when the save fails validation", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Modifier « Auto »" }));
    const sheet = screen.getByRole("dialog");
    await user.clear(within(sheet).getByLabelText("Capital restant dû (€)"));
    await user.click(within(sheet).getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByLabelText("Capital restant dû (€)").getAttribute("aria-invalid")).toBe("true"),
    );
    expect(mocks.repo!.updateLoan).not.toHaveBeenCalled();
  });

  it("closes the sheet with Escape and gives the focus back to the card", async () => {
    const user = setup();
    const card = screen.getByRole("button", { name: "Modifier « Prêt travaux »" });
    await user.click(card);
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it("« Ajouter » opens an empty add sheet", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    const sheet = screen.getByRole("dialog", { name: "Ajouter un crédit" });
    expect(within(sheet).getByRole("button", { name: "Ajouter le crédit" })).toBeTruthy();
  });

  it("AC-05: « Ajouter » is disabled at the limit and described by « 6 crédits sur 6 »", () => {
    setup(Array.from({ length: 6 }, (_, i) => makeLoan(i + 1)));
    const add = screen.getByRole("button", { name: "Ajouter" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(document.getElementById(add.getAttribute("aria-describedby")!)!.textContent).toBe("6 crédits sur 6");
  });

  it("folds the archived loans into a closed « Soldés » section", () => {
    setup([revolving], [makeLoan(9, { name: "Ancien prêt", archivedAt: "2026-05-01T00:00:00Z" })]);
    const details = screen.getByText("Soldés (1)").closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Ancien prêt");
  });

  it("with no loan, shows the empty message and no totals", () => {
    setup([]);
    expect(screen.getByText(/Aucun crédit en cours/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Totaux" })).toBeNull();
  });

  it("keeps the desktop page when the window is wide", () => {
    phone(false);
    setup();
    expect(screen.queryByRole("region", { name: "Remboursés en priorité" })).toBeNull();
    expect(screen.getByRole("region", { name: "Formulaire crédit" })).toBeTruthy();
  });
});
