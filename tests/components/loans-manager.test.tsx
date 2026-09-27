/** LoansManager (/credits): the add form is replaced by the limit message once 6 loans are active. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLoanRows } from "@/app/(app)/credits/loan-view";
import { LoansManager } from "@/app/(app)/credits/loans-manager";
import { type RepositoryMock, createRepositoryMock, makeLoan } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: vi.fn(),
}));

function renderManager(count: number) {
  mocks.repo = createRepositoryMock();
  const loans = Array.from({ length: count }, (_, i) => makeLoan(i + 1));
  render(
    <LoansManager
      rows={buildLoanRows(loans, null)}
      hasPlan={false}
      currentMonth="2026-09"
    />,
  );
  return screen.getByRole("region", { name: "Formulaire crédit" });
}

afterEach(cleanup);

describe("LoansManager", () => {
  it("shows the add form while fewer than 6 loans are active", () => {
    const section = renderManager(5);
    expect(within(section).getByRole("form", { name: "Ajouter un crédit" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Ajouter le crédit" })).toBeTruthy();
    expect(within(section).queryByText("6 crédits maximum.")).toBeNull();
  });

  it("replaces the add form with the limit message at 6 loans", () => {
    const section = renderManager(6);
    expect(within(section).getByText("6 crédits maximum.")).toBeTruthy();
    expect(within(section).queryByRole("form")).toBeNull();
    expect(within(section).queryByRole("button", { name: "Ajouter le crédit" })).toBeNull();
    expect(within(section).queryByLabelText("Capital restant dû (€)")).toBeNull();
  });

  it("still allows editing an existing loan at the limit, inline under its row", async () => {
    const section = renderManager(6);
    const user = userEvent.setup();
    const edit = screen.getByRole("button", { name: "Modifier « Prêt 1 »" });
    expect(edit.getAttribute("aria-expanded")).toBe("false");
    await user.click(edit);
    expect(edit.getAttribute("aria-expanded")).toBe("true");
    const row = screen.getByRole("article", { name: /Prêt 1/ }).closest("li")!;
    expect(within(row).getByRole("form", { name: "Modifier « Prêt 1 »" })).toBeTruthy();
    // The add section keeps the limit message; editing does not need a free slot.
    expect(within(section).getByText("6 crédits maximum.")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Supprimer « Prêt 1 »" })).toBeTruthy();

    await user.click(within(row).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("form", { name: "Modifier « Prêt 1 »" })).toBeNull();
    expect(document.activeElement).toBe(edit);
  });
});
