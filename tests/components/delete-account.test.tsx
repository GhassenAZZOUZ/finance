/** « Supprimer mon compte » (issue #37, SPEC D26): typed confirmation, backup first, sign-out after. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountCard } from "@/app/(app)/donnees/delete-account-card";
import { tourStorageKey } from "@/components/app/tour-logic";
import { type RepositoryMock, createRepositoryMock, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  replace: vi.fn(),
  signOut: vi.fn(),
  download: vi.fn(),
}));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: vi.fn() }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: makeSnapshot(), email: "moi@example.test" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { signOut: mocks.signOut } }) }));
vi.mock("@/lib/export/download", () => ({ downloadFile: mocks.download }));

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.replace.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.download.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

async function openConfirmation() {
  const user = userEvent.setup();
  render(<DeleteAccountCard />);
  await user.click(screen.getByRole("button", { name: "Supprimer mon compte…" }));
  return user;
}

describe("DeleteAccountCard", () => {
  it("only enables the deletion once SUPPRIMER is typed exactly", async () => {
    const user = await openConfirmation();
    const confirm = screen.getByRole("button", { name: "Supprimer définitivement" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(screen.getByLabelText(/tapez SUPPRIMER/), "supprimer");
    expect(confirm.disabled).toBe(true);
    await user.clear(screen.getByLabelText(/tapez SUPPRIMER/));
    await user.type(screen.getByLabelText(/tapez SUPPRIMER/), "SUPPRIMER");
    expect(confirm.disabled).toBe(false);
    expect(mocks.repo!.deleteAccount).not.toHaveBeenCalled();
  });

  it("says the deletion is irreversible and mentions the host's backups", async () => {
    await openConfirmation();
    expect(screen.getByText(/irréversible/).textContent).toContain("sauvegardes techniques de l’hébergeur");
  });

  it("offers the JSON backup before deleting", async () => {
    const user = await openConfirmation();
    await user.click(screen.getByRole("button", { name: /Télécharger d’abord ma sauvegarde/ }));
    expect(mocks.repo!.load).toHaveBeenCalled();
    expect(mocks.download).toHaveBeenCalledWith(expect.stringMatching(/\.json$/), expect.any(String), "application/json");
    expect(mocks.repo!.deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account, clears the tour flag, keeps the theme, signs out and goes to the login page", async () => {
    localStorage.setItem(tourStorageKey("moi@example.test"), "seen");
    localStorage.setItem("finance-theme", "dark");
    const user = await openConfirmation();
    await user.type(screen.getByLabelText(/tapez SUPPRIMER/), "SUPPRIMER");
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    expect(mocks.repo!.deleteAccount).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.replace).toHaveBeenCalledWith("/login/?compte-supprime");
    expect(localStorage.getItem(tourStorageKey("moi@example.test"))).toBeNull();
    expect(localStorage.getItem("finance-theme")).toBe("dark");
  });

  it("keeps the user signed in and explains when the deletion fails", async () => {
    mocks.repo!.deleteAccount.mockRejectedValueOnce(new Error("offline"));
    const user = await openConfirmation();
    await user.type(screen.getByLabelText(/tapez SUPPRIMER/), "SUPPRIMER");
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    expect((await screen.findByRole("alert")).textContent).toContain("n’a pas été supprimé");
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
