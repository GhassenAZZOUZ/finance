/** « Gérer » a user's plan in the back-office (issue #158, US-15). Invented data only. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanPanel } from "@/app/admin/plan-panel";
import type { UserRow } from "@/lib/admin/client";

const mocks = vi.hoisted(() => ({ callAdmin: vi.fn() }));
vi.mock("@/lib/admin/client", async (original) => ({ ...(await original<typeof import("@/lib/admin/client")>()), callAdmin: mocks.callAdmin }));

const USER: UserRow = {
  userId: "11111111-2222-3333-4444-555555555555",
  email: "alice@example.test",
  createdAt: "2027-01-05T10:00:00Z",
  lastSignInAt: null,
  plan: "Free",
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  loans: 1,
  goals: 0,
  stripeCustomerId: null,
  grantReason: null,
  grantExpiresAt: null,
};

const onChanged = vi.fn();
beforeEach(() => {
  mocks.callAdmin.mockReset();
  onChanged.mockReset();
});
afterEach(cleanup);

describe("PlanPanel", () => {
  it("shows the plan, the offered Pro and the Stripe link", () => {
    render(<PlanPanel user={{ ...USER, plan: "Pro offert", grantReason: "early_user", grantExpiresAt: "2027-12-31T23:00:00Z", stripeCustomerId: "cus_ABC" }} onChanged={onChanged} />);
    expect(screen.getByText("au lancement, jusqu’au 31 décembre 2027 inclus")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ouvrir dans Stripe/ }).getAttribute("href")).toBe("https://dashboard.stripe.com/customers/cus_ABC");
  });

  it("offers Pro only with a reason, the end date being optional", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: true, data: { granted: true } });
    const user = userEvent.setup({ delay: null });
    render(<PlanPanel user={USER} onChanged={onChanged} />);
    const offer = screen.getByRole("button", { name: "Offrir Pro" }) as HTMLButtonElement;
    expect(offer.disabled).toBe(true);
    await user.type(screen.getByLabelText("Motif (obligatoire)"), "Geste commercial");
    await user.type(screen.getByLabelText("Jusqu’au (inclus, facultatif)"), "2027-12-31");
    await user.click(offer);
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "plan.grant", userId: USER.userId, reason: "Geste commercial", endsOn: "2027-12-31", confirm: false });
    expect(await screen.findByText("Pro offert jusqu’au 31 décembre 2027 inclus.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("asks for a confirmation when the account is already Pro, then sends it", async () => {
    mocks.callAdmin.mockResolvedValueOnce({ ok: false, status: 409, error: "already_pro" }).mockResolvedValueOnce({ ok: true, data: { granted: true } });
    const user = userEvent.setup({ delay: null });
    render(<PlanPanel user={{ ...USER, plan: "Essai" }} onChanged={onChanged} />);
    await user.type(screen.getByLabelText("Motif (obligatoire)"), "Prolongation");
    await user.click(screen.getByRole("button", { name: "Offrir Pro" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ce compte est déjà « Essai »");
    await user.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(mocks.callAdmin).toHaveBeenLastCalledWith(expect.objectContaining({ action: "plan.grant", confirm: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it("shows the refusals in French (own account, past date)", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: false, status: 409, error: "self" });
    const user = userEvent.setup({ delay: null });
    render(<PlanPanel user={USER} onChanged={onChanged} />);
    await user.type(screen.getByLabelText("Motif (obligatoire)"), "test");
    await user.click(screen.getByRole("button", { name: "Offrir Pro" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Action impossible sur votre propre compte.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("removes an offered Pro after a confirmation; no button without an offer", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: true, data: { revoked: true } });
    const user = userEvent.setup({ delay: null });
    render(<PlanPanel user={{ ...USER, plan: "Pro offert", grantReason: "gift" }} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Retirer le Pro offert" }));
    expect(mocks.callAdmin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer le retrait" }));
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "plan.revoke", userId: USER.userId, reason: "" });
    expect(await screen.findByText("Pro offert retiré.")).toBeTruthy();
    cleanup();
    render(<PlanPanel user={USER} onChanged={onChanged} />);
    expect(screen.queryByRole("button", { name: "Retirer le Pro offert" })).toBeNull();
  });
});
