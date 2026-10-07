/** Deleting an account from the back-office (issue #159, US-16). Invented data only. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeletePanel } from "@/app/admin/delete-panel";
import type { UserRow } from "@/lib/admin/client";

const mocks = vi.hoisted(() => ({ callAdmin: vi.fn() }));
vi.mock("@/lib/admin/client", async (original) => ({ ...(await original<typeof import("@/lib/admin/client")>()), callAdmin: mocks.callAdmin }));

const USER: UserRow = {
  userId: "11111111-2222-3333-4444-555555555555",
  email: "alice@example.test",
  createdAt: "2027-01-05T10:00:00Z",
  lastSignInAt: null,
  plan: "Pro payant",
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  loans: 1,
  goals: 0,
  stripeCustomerId: "cus_ABC",
  grantReason: null,
  grantExpiresAt: null,
};

const onDeleted = vi.fn();
beforeEach(() => {
  mocks.callAdmin.mockReset();
  onDeleted.mockReset();
});
afterEach(cleanup);

async function openForm() {
  const user = userEvent.setup({ delay: null });
  render(<DeletePanel user={USER} onDeleted={onDeleted} />);
  await user.click(screen.getByRole("button", { name: "Supprimer le compte" }));
  return user;
}

describe("DeletePanel", () => {
  it("says the deletion is permanent and stays disabled until the reference and the exact e-mail are typed", async () => {
    const user = await openForm();
    expect(screen.getByText("définitive").tagName).toBe("STRONG");
    expect(screen.getByText(/résilié immédiatement, sans remboursement/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Supprimer définitivement" }) as HTMLButtonElement;
    await user.type(screen.getByLabelText("Pour confirmer, saisissez alice@example.test"), "bob@example.test");
    await user.type(screen.getByLabelText("Référence de la demande (obligatoire)"), "e-mail du 7 octobre");
    expect(submit.disabled).toBe(true);
    await user.clear(screen.getByLabelText("Pour confirmer, saisissez alice@example.test"));
    await user.type(screen.getByLabelText("Pour confirmer, saisissez alice@example.test"), " ALICE@example.test ");
    expect(submit.disabled).toBe(false);
  });

  it("sends the typed e-mail and the reference, then reports the result", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: true, data: { deleted: true, subscriptionCancelled: true, emailSent: true } });
    const user = await openForm();
    await user.type(screen.getByLabelText("Référence de la demande (obligatoire)"), "e-mail du 7 octobre");
    await user.type(screen.getByLabelText("Pour confirmer, saisissez alice@example.test"), "alice@example.test");
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "users.delete", userId: USER.userId, confirmEmail: "alice@example.test", requestRef: "e-mail du 7 octobre" });
    expect(onDeleted).toHaveBeenCalledWith("Le compte alice@example.test est supprimé. Son abonnement Stripe est résilié. Un e-mail de confirmation lui a été envoyé.");
  });

  it.each([
    ["stripe_error", "Stripe n’a pas pu résilier l’abonnement : le compte n’a pas été supprimé. Réessayez dans un instant."],
    ["delete_failed_after_stripe", "L’abonnement est résilié mais le compte existe encore. Relancez la suppression pour la terminer."],
    ["user_not_found", "Ce compte n’existe plus."],
    ["target_admin", "Ce compte est administrateur : retirez-le d’abord des administrateurs."],
  ])("shows « %s » in French and keeps the form", async (code, text) => {
    mocks.callAdmin.mockResolvedValue({ ok: false, status: 409, error: code });
    const user = await openForm();
    await user.type(screen.getByLabelText("Référence de la demande (obligatoire)"), "ref");
    await user.type(screen.getByLabelText("Pour confirmer, saisissez alice@example.test"), "alice@example.test");
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
