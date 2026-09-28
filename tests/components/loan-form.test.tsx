/** LoanFormPanel (/credits): negative capital and APR > 100 % are rejected; valid input is saved in cents. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoanFormPanel } from "@/app/(app)/credits/loan-form";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));

function renderForm() {
  const onSaved = vi.fn();
  render(<LoanFormPanel editing={null} defaultPaidThroughMonth="2026-09" onSaved={onSaved} onCancel={vi.fn()} />);
  return { onSaved, user: userEvent.setup() };
}

beforeEach(() => {
  // Two loans already exist: below the limit of 6.
  mocks.repo = createRepositoryMock(makeSnapshot({ loans: [makeLoan(1), makeLoan(2)] }));
  mocks.notify.mockClear();
});
afterEach(cleanup);

describe("LoanFormPanel", () => {
  it("rejects a negative capital and an APR above 100 % without saving", async () => {
    const { onSaved, user } = renderForm();
    await user.type(screen.getByLabelText("Capital restant dû (€)"), "-1000");
    await user.type(screen.getByLabelText("TAEG (%)"), "150");
    await user.type(screen.getByLabelText("Mensualité (€)"), "100");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));

    expect(await screen.findByText("Le montant ne peut pas être négatif")).toBeTruthy();
    expect(screen.getByText("Le taux doit être inférieur ou égal à 100 %")).toBeTruthy();
    const principal = screen.getByLabelText("Capital restant dû (€)");
    const apr = screen.getByLabelText("TAEG (%)");
    expect(principal.getAttribute("aria-invalid")).toBe("true");
    expect(apr.getAttribute("aria-invalid")).toBe("true");
    expect(principal.getAttribute("aria-describedby")).toContain("credit-principal-error");
    expect(screen.getByLabelText("Mensualité (€)").getAttribute("aria-invalid")).toBeNull();
    // Typed values survive the failed submit.
    expect((principal as HTMLInputElement).value).toBe("-1000");
    expect(mocks.repo?.createLoan).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves valid French-formatted input in cents and calls onSaved", async () => {
    const { onSaved, user } = renderForm();
    await user.type(screen.getByLabelText("Capital restant dû (€)"), "8 200");
    await user.type(screen.getByLabelText("TAEG (%)"), "4,9");
    await user.type(screen.getByLabelText("Mensualité (€)"), "245,30");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.createLoan).toHaveBeenCalledTimes(1);
    expect(mocks.repo?.createLoan).toHaveBeenCalledWith({
      name: null,
      type: null,
      principal: 820_000,
      principalPaidThroughMonth: "2026-09",
      apr: 0.049,
      monthlyPayment: 24_530,
      contractEndMonth: null,
      penaltyPct: null,
      penaltyCapMonths: null,
      kind: "loan",
      creditLimit: null,
    });
    expect(mocks.repo?.updateLoan).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    // Third active loan, no name: default display name.
    expect(onSaved).toHaveBeenCalledWith("« Crédit 3 » a été ajouté.");
  });

  it("saves an IRA of 3 % capped at 6 months; a negative cap is rejected on its field (issue #9)", async () => {
    const { onSaved, user } = renderForm();
    await user.type(screen.getByLabelText("Capital restant dû (€)"), "100000");
    await user.type(screen.getByLabelText("TAEG (%)"), "3,5");
    await user.type(screen.getByLabelText("Mensualité (€)"), "800");
    await user.type(screen.getByLabelText("IRA (% du capital remboursé, facultatif)"), "3");
    const cap = screen.getByLabelText("Plafond des IRA (mois d’intérêts, facultatif)");
    await user.type(cap, "-6");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));
    expect(await screen.findByText("Nombre de mois entier attendu")).toBeTruthy();
    expect(screen.getByLabelText("Plafond des IRA (mois d’intérêts, facultatif)").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.repo?.createLoan).not.toHaveBeenCalled();

    const capAgain = screen.getByLabelText("Plafond des IRA (mois d’intérêts, facultatif)");
    await user.clear(capAgain);
    await user.type(capAgain, "6");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.createLoan).toHaveBeenCalledWith(expect.objectContaining({ penaltyPct: 0.03, penaltyCapMonths: 6 }));
  });

  it("adds a bank overdraft: limit, balance, agios rate, no monthly payment (issue #28)", async () => {
    const { onSaved, user } = renderForm();
    await user.click(screen.getByRole("radio", { name: "Découvert bancaire" }));
    expect(screen.queryByLabelText("Mensualité (€)")).toBeNull();
    expect(screen.queryByLabelText("TAEG (%)")).toBeNull();
    await user.type(screen.getByLabelText("Nom (facultatif)"), "Compte courant");
    await user.type(screen.getByLabelText("Autorisation de découvert (€)"), "1 000");
    await user.type(screen.getByLabelText("Solde utilisé (€)"), "1200");
    await user.type(screen.getByLabelText("Taux des agios (%)"), "16");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));
    expect(await screen.findByText("Le solde utilisé ne peut pas dépasser l’autorisation")).toBeTruthy();
    expect(mocks.repo?.createLoan).not.toHaveBeenCalled();

    const balance = screen.getByLabelText("Solde utilisé (€)");
    await user.clear(balance);
    await user.type(balance, "800");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.createLoan).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "overdraft", creditLimit: 100_000, principal: 80_000, apr: 0.16, monthlyPayment: 0 }),
    );
  });

  it("refuses a 7th loan even if the form is submitted (limit re-checked against the repository)", async () => {
    mocks.repo = createRepositoryMock(makeSnapshot({ loans: [1, 2, 3, 4, 5, 6].map((i) => makeLoan(i)) }));
    const { onSaved, user } = renderForm();
    await user.type(screen.getByLabelText("Capital restant dû (€)"), "1000");
    await user.type(screen.getByLabelText("TAEG (%)"), "3");
    await user.type(screen.getByLabelText("Mensualité (€)"), "100");
    await user.click(screen.getByRole("button", { name: "Ajouter le crédit" }));

    expect((await screen.findByRole("alert")).textContent).toBe("6 crédits maximum");
    expect(mocks.repo.createLoan).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
