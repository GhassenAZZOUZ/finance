/** ExceptionsCard (/budget): one-off exceptions need a label and an amount > 0; valid ones are saved in cents. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExceptionsCard } from "@/app/(app)/budget/exceptions-card";
import { type RepositoryMock, createRepositoryMock } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));
// budget/actions.ts also imports the Supabase browser client (budget save); unused here.
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: vi.fn() }));

function renderCard() {
  render(<ExceptionsCard exceptions={[]} startMonth="2026-01" defaultMonth="2026-03" hasSettings />);
  return userEvent.setup();
}

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockClear();
});
afterEach(cleanup);

describe("ExceptionsCard", () => {
  it("rejects an amount of 0 and an empty label without saving", async () => {
    const user = renderCard();
    await user.type(screen.getByLabelText("Montant (€)"), "0");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Certains champs sont à corriger.")).toBeTruthy();
    expect(screen.getByText("Libellé requis")).toBeTruthy();
    expect(screen.getByText("Le montant doit être supérieur à 0")).toBeTruthy();
    expect(screen.getByLabelText("Libellé").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Montant (€)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Mois").getAttribute("aria-invalid")).toBeNull();
    expect(mocks.repo?.addException).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    const user = renderCard();
    await user.type(screen.getByLabelText("Libellé"), "Réparation");
    await user.type(screen.getByLabelText("Montant (€)"), "-50");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(await screen.findByText("Le montant ne peut pas être négatif")).toBeTruthy();
    expect(mocks.repo?.addException).not.toHaveBeenCalled();
  });

  it("saves a valid exception with the amount in cents and the chosen kind", async () => {
    const user = renderCard();
    await user.click(screen.getByRole("radio", { name: "Revenu en plus" }));
    await user.type(screen.getByLabelText("Libellé"), "  Prime ");
    await user.type(screen.getByLabelText("Montant (€)"), "1 500,50");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(mocks.repo?.addException).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.addException).toHaveBeenCalledWith({
      month: "2026-03",
      kind: "income",
      label: "Prime",
      amount: 150_050,
    });
    expect(await screen.findByText("✓ « Prime » a été ajouté.")).toBeTruthy();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("defaults to an expense", async () => {
    const user = renderCard();
    expect((screen.getByRole("radio", { name: "Dépense en plus" }) as HTMLInputElement).checked).toBe(true);
    await user.type(screen.getByLabelText("Libellé"), "Vacances");
    await user.type(screen.getByLabelText("Montant (€)"), "800");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => expect(mocks.repo?.addException).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.addException).toHaveBeenCalledWith({ month: "2026-03", kind: "expense", label: "Vacances", amount: 80_000 });
  });
});
