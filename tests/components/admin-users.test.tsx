/** Back-office user list (issue #157, US-14). Invented data only. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersSection } from "@/app/admin/users-section";
import type { UserRow } from "@/lib/admin/client";

const mocks = vi.hoisted(() => ({ callAdmin: vi.fn() }));
vi.mock("@/lib/admin/client", async (original) => ({ ...(await original<typeof import("@/lib/admin/client")>()), callAdmin: mocks.callAdmin }));

const row = (over: Partial<UserRow>): UserRow => ({
  userId: "u1",
  email: "alice@example.test",
  createdAt: "2027-01-05T10:00:00Z",
  lastSignInAt: "2027-03-01T10:00:00Z",
  plan: "Pro payant",
  status: "active",
  currentPeriodEnd: "2027-04-05T10:00:00Z",
  cancelAtPeriodEnd: true,
  loans: 3,
  goals: 2,
  ...over,
});

beforeEach(() => {
  mocks.callAdmin.mockReset();
  mocks.callAdmin.mockImplementation(async (body: { action: string; page?: number }) =>
    body.action === "users.export"
      ? { ok: true, data: { csv: "email\r\n", count: 2 } }
      : {
          ok: true,
          data: {
            rows: body.page === 2 ? [row({ userId: "u3", email: "zed@example.test", plan: "Free", status: null, cancelAtPeriodEnd: false, loans: 0, goals: 0 })] : [row({}), row({ userId: "u2", email: "bob@example.test", plan: "Essai", status: "trialing", cancelAtPeriodEnd: false })],
            total: 51,
            page: body.page ?? 1,
            pages: 2,
          },
        },
  );
});
afterEach(cleanup);

const lastCall = () => mocks.callAdmin.mock.calls.at(-1)![0];

describe("UsersSection", () => {
  it("lists the accounts with plan, subscription and counts, never an amount", async () => {
    render(<UsersSection />);
    const table = within(await screen.findByRole("region", { name: "Liste des utilisateurs" }));
    expect(screen.getByRole("heading", { name: "Utilisateurs (51)" })).toBeTruthy();
    const alice = table.getByRole("row", { name: /alice@example.test/ });
    expect(alice.textContent).toContain("Pro payant");
    expect(alice.textContent).toContain("Actif, résiliation programmée");
    expect(alice.textContent).toMatch(/32$/);
    expect(alice.textContent).not.toMatch(/€/);
    expect(lastCall()).toEqual({ action: "users.list", search: "", plan: null, status: null, sort: "created", page: 1 });
  });

  it("sends the search, filters and sort to the server, back to page 1", async () => {
    const user = userEvent.setup({ delay: null });
    render(<UsersSection />);
    await screen.findByRole("region", { name: "Liste des utilisateurs" });
    await user.click(screen.getByRole("button", { name: "Suivante" }));
    await waitFor(() => expect(lastCall()).toMatchObject({ page: 2 }));
    await user.type(screen.getByLabelText("Rechercher (e-mail)"), "ALI");
    await user.selectOptions(screen.getByLabelText("Plan"), "Essai");
    await user.selectOptions(screen.getByLabelText("Statut d’abonnement"), "cancel_scheduled");
    await user.selectOptions(screen.getByLabelText("Tri"), "last_sign_in");
    await waitFor(() =>
      expect(lastCall()).toEqual({ action: "users.list", search: "ALI", plan: "Essai", status: "cancel_scheduled", sort: "last_sign_in", page: 1 }),
    );
  });

  it("exports the filtered list as a CSV file", async () => {
    const createObjectURL = vi.fn(() => "blob:csv");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup({ delay: null });
    render(<UsersSection />);
    await screen.findByRole("region", { name: "Liste des utilisateurs" });
    await user.click(screen.getByRole("button", { name: "Exporter en CSV" }));
    expect(mocks.callAdmin).toHaveBeenCalledWith({ action: "users.export", search: "", plan: null, status: null, sort: "created" });
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("shows the server's refusal in French", async () => {
    mocks.callAdmin.mockResolvedValue({ ok: false, status: 500, error: "failed" });
    render(<UsersSection />);
    expect((await screen.findByRole("alert")).textContent).toBe("L’action a échoué. Réessayez dans un instant.");
  });
});
