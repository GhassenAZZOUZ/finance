/**
 * ImportView (/import, issue #8): preview before saving, cell errors block the import, cancel
 * writes nothing, confirm saves through the repository.
 */
import { readFileSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportView } from "@/app/(app)/import/import-view";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  notify: vi.fn(),
  snapshot: null as FinanceSnapshot | null,
  read: vi.fn(),
}));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: mocks.snapshot }) }));

const TEMPLATE = readFileSync("docs/plan_financier.template.xlsx");
const templateFile = () => new File([TEMPLATE], "plan_financier.xlsx");

beforeEach(() => {
  mocks.snapshot = makeSnapshot({ settings: makeSettings(), loans: [makeLoan(1, { name: "Prêt auto" }), makeLoan(2)] });
  mocks.repo = createRepositoryMock(mocks.snapshot);
  mocks.notify.mockReset();
});
afterEach(cleanup);

async function upload(file: File) {
  render(<ImportView />);
  await userEvent.upload(screen.getByLabelText("Choisir le classeur"), file);
}

describe("ImportView", () => {
  it("previews the template with counts and a replace warning, saving nothing yet", async () => {
    await upload(templateFile());
    const preview = await screen.findByRole("heading", { name: /Aperçu de « plan_financier.xlsx »/ });
    expect(preview).toBeTruthy();
    expect(screen.getByText(/8 paramètres, 15 lignes de budget, 6 crédits/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Charges fixes (8)" })).toBeTruthy();
    expect(screen.getByText("Carte revolving")).toBeTruthy();
    expect(screen.getByText("remplace").closest("p")?.textContent).toContain("2 crédits actifs");
    expect(mocks.repo!.saveBudget).not.toHaveBeenCalled();
  });

  it("imports on confirm in one call: budget, loan matched by name updated, others created / removed", async () => {
    await upload(templateFile());
    await userEvent.click(await screen.findByRole("button", { name: "Importer" }));
    await screen.findByText(/Import terminé : paramètres, 15 lignes de budget et 6 crédits/);
    expect(mocks.repo!.applyImport).toHaveBeenCalledOnce();
    const plan = mocks.repo!.applyImport.mock.calls[0]![0];
    expect(plan.lines).toHaveLength(15);
    expect(plan.loanUpdates).toEqual([{ id: "loan-1", draft: expect.objectContaining({ name: "Prêt auto" }) }]);
    expect(plan.loanCreates).toHaveLength(5);
    expect(plan.loanRemovals).toEqual(["loan-2"]);
    expect(mocks.repo!.saveBudget).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalled();
  });

  it("cancel returns to the file choice without writing", async () => {
    await upload(templateFile());
    await userEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
    expect(mocks.repo!.applyImport).not.toHaveBeenCalled();
  });

  it("rejects a file that is not the template", async () => {
    await upload(new File(["Mois;Revenus"], "plan.xlsx"));
    expect((await screen.findByRole("alert")).textContent).toContain("n’est pas le modèle attendu");
    expect(screen.queryByRole("button", { name: "Importer" })).toBeNull();
  });

  it("shows a retryable error when saving fails, with nothing to reload", async () => {
    mocks.repo!.applyImport.mockRejectedValueOnce(new Error("offline"));
    await upload(templateFile());
    await userEvent.click(await screen.findByRole("button", { name: "Importer" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("rien n’a été modifié. Réessayez"));
    expect(screen.getByRole("button", { name: "Importer" })).toBeTruthy();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
