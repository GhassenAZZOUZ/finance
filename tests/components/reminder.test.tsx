/** Monthly reminder UI (issue #6): the « Mes données » switch and the public unsubscribe page. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReminderCard } from "@/app/(app)/donnees/reminder-card";
import { Unsubscribe } from "@/app/rappel/unsubscribe";
import type { FinanceSnapshot } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  notify: vi.fn(),
  snapshot: null as FinanceSnapshot | null,
  token: "",
  rpc: vi.fn(),
}));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: mocks.snapshot, email: "moi@example.test" }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.token ? { jeton: mocks.token } : {}) }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ rpc: mocks.rpc }) }));

const TOKEN = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.snapshot = makeSnapshot({ reminderEnabled: true });
  mocks.repo = createRepositoryMock(mocks.snapshot);
  mocks.notify.mockReset();
  mocks.rpc.mockReset();
});
afterEach(cleanup);

describe("ReminderCard", () => {
  it("shows the reminder on by default and turns it off", async () => {
    render(<ReminderCard />);
    const box = screen.getByRole("checkbox", { name: /Recevoir le rappel/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.textContent).toContain("moi@example.test");
    expect(box.closest("label")?.textContent).toContain("moi@example.test");
    await userEvent.click(box);
    expect(mocks.repo!.setReminder).toHaveBeenCalledWith(false);
    expect(mocks.notify).toHaveBeenCalled();
  });

  it("reports a failed change", async () => {
    mocks.repo!.setReminder.mockRejectedValueOnce(new Error("offline"));
    render(<ReminderCard />);
    await userEvent.click(screen.getByRole("checkbox"));
    expect((await screen.findByRole("alert")).textContent).toContain("n’a pas été enregistré");
  });
});

describe("Unsubscribe page", () => {
  it("turns the reminder off with the token of the link", async () => {
    mocks.token = TOKEN;
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    render(<Unsubscribe />);
    expect(await screen.findByText("Vous ne recevrez plus le rappel mensuel.")).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith("unsubscribe_reminder", { p_token: TOKEN });
  });

  it("refuses a tampered or malformed token", async () => {
    mocks.token = TOKEN;
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    render(<Unsubscribe />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("n’est pas valide"));
    cleanup();
    mocks.token = "pas-un-jeton";
    render(<Unsubscribe />);
    expect(screen.getByRole("alert").textContent).toContain("n’est pas valide");
  });
});
