/** BudgetForm (/budget): negative line amounts block the save; the live preview follows the edits. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetForm } from "@/app/(app)/budget/budget-form";
import type { BudgetLine } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock, makeSettings } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  notify: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { getSession: mocks.getSession } }),
}));

const SETTINGS = makeSettings();
const LINES: BudgetLine[] = [
  { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0 },
  { id: "l-rent", category: "fixed", label: "Loyer", amount: 90_000, position: 0 },
  { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0 },
];

function renderForm() {
  render(<BudgetForm settings={SETTINGS} lines={LINES} loans={[]} exceptions={[]} currentMonth="2026-09" />);
  return userEvent.setup();
}

const amountInput = (label: string) => screen.getByLabelText(`Montant mensuel en euros (${label})`);
const margin = () => screen.getByText("Marge mensuelle (mois normal)").nextElementSibling?.textContent;

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockClear();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
});
afterEach(cleanup);

describe("BudgetForm", () => {
  it("shows the error on the negative line and does not save", async () => {
    const user = renderForm();
    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "-50");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Le montant ne peut pas être négatif")).toBeTruthy();
    expect(amountInput("Loyer").getAttribute("aria-invalid")).toBe("true");
    expect(amountInput("Loyer").getAttribute("aria-describedby")).toBe("line-l-rent-amount-error");
    expect(amountInput("Salaire").getAttribute("aria-invalid")).toBeNull();
    expect(amountInput("Courses").getAttribute("aria-invalid")).toBeNull();
    expect(
      screen.getByText("Certains champs sont invalides. Corrigez-les puis enregistrez à nouveau. (1 erreur)"),
    ).toBeTruthy();
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("updates the margin in the preview as an amount changes, before saving", async () => {
    const user = renderForm();
    expect(screen.getByRole("heading", { name: "Aperçu" })).toBeTruthy();
    // 3 000 − 900 − 400 = 1 700 €
    expect(margin()).toBe(formatEuros(170_000));

    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "1 200");
    // 3 000 − 1 200 − 400 = 1 400 €
    expect(margin()).toBe(formatEuros(140_000));
    expect(screen.getByRole("heading", { name: "Aperçu (non enregistré)" })).toBeTruthy();

    await user.clear(amountInput("Salaire"));
    await user.type(amountInput("Salaire"), "1 500");
    // 1 500 − 1 200 − 400 = −100 € (flagged as negative)
    expect(margin()).toBe(`${formatEuros(-10_000)} (négative)`);

    // A negative amount is left out of the live totals (and flagged) until saved.
    await user.clear(amountInput("Courses"));
    await user.type(amountInput("Courses"), "-5");
    expect(margin()).toBe(formatEuros(30_000));
    expect(screen.getByText("1 montant invalide est ignoré dans les totaux.")).toBeTruthy();

    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });

  it("saves valid lines in cents", async () => {
    const user = renderForm();
    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "950,5");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mocks.repo?.saveBudget).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveBudget).toHaveBeenCalledWith(SETTINGS, [
      { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0 },
      { id: "l-rent", category: "fixed", label: "Loyer", amount: 95_050, position: 0 },
      { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0 },
    ]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("does not save when the session has expired", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Session expirée : reconnectez-vous.")).toBeTruthy();
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });
});
