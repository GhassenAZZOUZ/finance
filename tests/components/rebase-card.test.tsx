/**
 * RebaseCard (/suivi, issue #5): previews the re-based plan, asks for an inline confirmation, then
 * freezes the history, saves the new settings and updates / archives the loans, in that order.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RebaseCard } from "@/app/(app)/suivi/rebase-card";
import { computePlan } from "@/lib/domain/plan";
import { planRebase } from "@/lib/domain/rebase";
import type { MonthlyActual } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));

const LOANS = [makeLoan(1, { name: "Auto" }), makeLoan(2, { name: "Travaux" })];
const LABELS = { "loan-1": "Auto", "loan-2": "Travaux" };

function actual(month: string, overrides: Partial<MonthlyActual> = {}): MonthlyActual {
  return {
    id: `act-${month}`,
    month,
    income: null,
    expenses: null,
    movingSavings: 100_000,
    emergencySavings: 150_000,
    freeSavings: 0,
    loanBalances: [
      { loanId: "loan-1", balance: 450_000 },
      { loanId: "loan-2", balance: 480_000 },
    ],
    goalBalances: [],
    frozen: null,
    ...overrides,
  };
}

const SNAPSHOT = makeSnapshot({
  settings: makeSettings({ startMonth: "2026-01" }),
  loans: LOANS,
  actuals: [
    actual("2026-02"),
    actual("2026-03", {
      movingSavings: 150_000,
      emergencySavings: 200_000,
      freeSavings: 5_000,
      loanBalances: [
        { loanId: "loan-1", balance: 400_000 },
        { loanId: "loan-2", balance: 0 },
      ],
    }),
  ],
});

function renderCard() {
  const preview = planRebase(SNAPSHOT, computePlan(SNAPSHOT)!);
  const view = render(<RebaseCard preview={preview} startMonth="2026-01" loanLabels={LABELS} />);
  return { user: userEvent.setup(), container: view.container };
}

/** Text with the non-breaking spaces of the French number format normalised. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
  mocks.repo = createRepositoryMock(SNAPSHOT);
  mocks.notify.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RebaseCard", () => {
  it("explains the new start month and the balances taken from the latest check-in", () => {
    const { container } = renderCard();
    const text = plain(container.textContent);

    expect(screen.getByRole("heading", { name: "Recaler le plan" })).toBeTruthy();
    expect(text).toContain("Votre plan repartira de avril 2026 avec vos soldes réels de mars 2026 :");
    expect(text).toContain(plain(`épargne déménagement ${formatEuros(150_000)}`));
    expect(text).toContain(plain(`fonds d’urgence ${formatEuros(200_000)}`));
    expect(text).toContain(plain(`épargne libre ${formatEuros(5_000)}`));
    expect(text).toContain(plain(`Auto : ${formatEuros(400_000)}`));
    expect(text).toContain("Travaux : soldé, sera archivé");
    expect(text).toContain("Les mois déjà saisis gardent les valeurs prévues avec lesquelles ils ont été comparés.");
  });

  it("renders nothing when there is nothing to re-base", () => {
    const { container } = render(<RebaseCard preview={null} startMonth="2026-01" loanLabels={LABELS} />);
    expect(container.textContent).toBe("");
  });

  it("asks for confirmation inline and can be cancelled without writing anything", async () => {
    const { user } = renderCard();
    await user.click(screen.getByRole("button", { name: "Recaler le plan…" }));

    const group = screen.getByRole("group", { name: "Confirmer le recalage du plan" });
    expect(plain(group.textContent)).toContain("Le début du plan passe de janvier 2026 à avril 2026.");
    expect(plain(group.textContent)).toContain("Le crédit soldé est archivé.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Annuler" }));

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("group", { name: "Confirmer le recalage du plan" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Recaler le plan…" }));
    expect(mocks.repo?.load).not.toHaveBeenCalled();
    expect(mocks.repo?.saveSettings).not.toHaveBeenCalled();
  });

  it("freezes the history, then saves the settings, updates and archives the loans", async () => {
    const { user } = renderCard();
    await user.click(screen.getByRole("button", { name: "Recaler le plan…" }));
    await user.click(screen.getByRole("button", { name: "Confirmer le recalage" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Plan recalé : il démarre en avril 2026.");
    expect(document.activeElement).toBe(status);

    const repo = mocks.repo!;
    expect(repo.freezeActuals).toHaveBeenCalledTimes(1);
    expect(repo.freezeActuals.mock.calls[0]?.[0].map((f) => f.month)).toEqual(["2026-02", "2026-03"]);
    expect(repo.freezeActuals.mock.calls[0]?.[0][0]?.frozen).toEqual(expect.objectContaining({ planStartMonth: "2026-01" }));
    expect(repo.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        startMonth: "2026-04",
        movingAlreadySaved: 150_000,
        emergencyExisting: 200_000,
        freeSavingsExisting: 5_000,
      }),
    );
    expect(repo.updateLoan).toHaveBeenCalledTimes(1);
    expect(repo.updateLoan).toHaveBeenCalledWith(
      "loan-1",
      expect.objectContaining({ principal: 400_000, principalPaidThroughMonth: "2026-03" }),
    );
    expect(repo.removeLoan).toHaveBeenCalledTimes(1);
    expect(repo.removeLoan).toHaveBeenCalledWith("loan-2");

    const order = [repo.freezeActuals, repo.saveSettings, repo.updateLoan, repo.removeLoan].map((fn) => fn.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("keeps the success message once the preview disappears after the reload", async () => {
    // The page stays mounted and recomputes the preview, which becomes null once re-based.
    const preview = planRebase(SNAPSHOT, computePlan(SNAPSHOT)!);
    const view = render(<RebaseCard preview={preview} startMonth="2026-01" loanLabels={LABELS} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Recaler le plan…" }));
    await user.click(screen.getByRole("button", { name: "Confirmer le recalage" }));
    await screen.findByRole("status");
    view.rerender(<RebaseCard preview={null} startMonth="2026-04" loanLabels={LABELS} />);

    expect(screen.getByRole("status").textContent).toContain("Plan recalé : il démarre en avril 2026.");
    expect(screen.queryByRole("button", { name: "Recaler le plan…" })).toBeNull();
  });

  it("shows the error and writes nothing more when the first write fails", async () => {
    mocks.repo!.freezeActuals.mockRejectedValueOnce(new Error("network"));
    const { user } = renderCard();
    await user.click(screen.getByRole("button", { name: "Recaler le plan…" }));
    await user.click(screen.getByRole("button", { name: "Confirmer le recalage" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Recalage impossible pour le moment.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmer le recalage" })).toHaveProperty("disabled", false));
    expect(mocks.repo?.saveSettings).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
