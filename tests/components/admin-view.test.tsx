/** Back-office access (issue #156, US-13): the page follows the server's answer. Invented data only. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminView } from "@/app/admin/admin-view";

const mocks = vi.hoisted(() => ({
  native: false,
  session: { user: { id: "u1" } } as unknown,
  replace: vi.fn(),
  callAdmin: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    auth: {
      getSession: async () => ({ data: { session: mocks.session } }),
      mfa: { listFactors: mocks.listFactors, enroll: mocks.enroll, unenroll: mocks.unenroll, challengeAndVerify: mocks.challengeAndVerify },
    },
  }),
}));
vi.mock("@/lib/admin/client", async (original) => ({ ...(await original<typeof import("@/lib/admin/client")>()), callAdmin: mocks.callAdmin }));

const ok = (data: unknown) => ({ ok: true, data });
const fail = (status: number, error: string) => ({ ok: false, status, error });

/** The admin function's answers, by action. */
function server(answers: Record<string, unknown>) {
  mocks.callAdmin.mockImplementation(async (body: { action: string }) => {
    const answer = answers[body.action];
    return typeof answer === "function" ? (answer as (b: unknown) => unknown)(body) : (answer ?? fail(500, "failed"));
  });
}

beforeEach(() => {
  mocks.native = false;
  mocks.session = { user: { id: "u1" } };
  for (const fn of [mocks.replace, mocks.callAdmin, mocks.listFactors, mocks.enroll, mocks.unenroll, mocks.challengeAndVerify]) fn.mockReset();
});
afterEach(cleanup);

const READY = {
  whoami: ok({ admin: true, email: "owner@example.test" }),
  "admins.list": ok({ admins: [{ userId: "u1", email: "owner@example.test", addedAt: "2026-10-08T09:00:00Z" }, { userId: "u2", email: "partner@example.test", addedAt: "2026-10-08T10:00:00Z" }] }),
  "audit.list": ok({ entries: [{ id: 1, at: "2026-10-08T10:00:00Z", action: "admins.add", admin: "owner@example.test", target: "partner@example.test", details: {} }] }),
};

describe("AdminView", () => {
  it("sends a signed-out visitor to the sign-in page", async () => {
    mocks.session = null;
    render(<AdminView />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login/"));
    expect(mocks.callAdmin).not.toHaveBeenCalled();
  });

  it("AC-02 — a non-admin sees « Accès refusé » and no data", async () => {
    server({ whoami: fail(403, "forbidden") });
    render(<AdminView />);
    expect(await screen.findByRole("heading", { name: "Accès refusé" })).toBeTruthy();
    expect(mocks.callAdmin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("second factor, first time: shows the QR code, then the code opens the back-office", async () => {
    let verified = false;
    server({ ...READY, whoami: () => (verified ? READY.whoami : fail(403, "mfa_required")) });
    mocks.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: "old", factor_type: "totp", status: "unverified" }] } });
    mocks.enroll.mockResolvedValue({ data: { id: "f1", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "JBSWY3DPEHPK3PXP" } }, error: null });
    mocks.challengeAndVerify.mockImplementation(async () => {
      verified = true;
      return { error: null };
    });
    render(<AdminView />);
    expect(await screen.findByRole("img", { name: /QR code/ })).toBeTruthy();
    expect(mocks.unenroll).toHaveBeenCalledWith({ factorId: "old" });
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText("Code de l’application"), "12a34 56");
    await user.click(screen.getByRole("button", { name: "Valider" }));
    expect(mocks.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    expect(await screen.findByRole("heading", { name: "Back-office" })).toBeTruthy();
  });

  it("second factor already set up: asks for the code, and says when it is wrong", async () => {
    server({ whoami: fail(403, "mfa_required") });
    mocks.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1", status: "verified" }], all: [] } });
    mocks.challengeAndVerify.mockResolvedValue({ error: { message: "invalid" } });
    render(<AdminView />);
    const user = userEvent.setup({ delay: null });
    await user.type(await screen.findByLabelText("Code de l’application"), "000000");
    await user.click(screen.getByRole("button", { name: "Valider" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Code incorrect");
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("AC-01 — the back-office lists the admins and the audit log; adds and removes an admin", async () => {
    server({ ...READY, "admins.add": ok({ added: true }), "admins.remove": fail(409, "last_admin") });
    render(<AdminView />);
    const admins = await screen.findByRole("region", { name: "Administrateurs" });
    expect(await within(admins).findByText(/partner@example.test/)).toBeTruthy();
    const audit = await within(screen.getAllByRole("region", { name: "Journal d’audit" })[0]!).findByRole("table");
    expect(within(audit).getByRole("row", { name: /Admin ajouté/ })).toBeTruthy();

    const user = userEvent.setup({ delay: null });
    await user.type(within(admins).getByLabelText(/Ajouter un administrateur/), "  New@Example.test ");
    await user.click(within(admins).getByRole("button", { name: "Ajouter" }));
    // An e-mail field drops the surrounding spaces itself; the server ignores the case.
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "admins.add", email: "New@Example.test" });
    expect(await within(admins).findByText("New@Example.test est maintenant administrateur.")).toBeTruthy();

    await user.click(within(admins).getByRole("button", { name: "Retirer partner@example.test" }));
    await user.click(within(admins).getByRole("button", { name: "Confirmer le retrait" }));
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "admins.remove", userId: "u2" });
    expect((await within(admins).findByRole("alert")).textContent).toBe("Il faut garder au moins un administrateur.");
  });

  it("AC-11 — not available in the Android app", () => {
    mocks.native = true;
    render(<AdminView />);
    expect(screen.getByText(/depuis le site web/)).toBeTruthy();
    expect(mocks.callAdmin).not.toHaveBeenCalled();
  });
});
