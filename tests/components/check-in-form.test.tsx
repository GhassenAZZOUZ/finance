/** CheckInForm (/suivi): required savings and loan balances must be filled; a complete form saves cents per loan. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkInMonths, prefillForm } from "@/app/(app)/suivi/logic";
import { CheckInForm } from "@/app/(app)/suivi/check-in-form";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));

const LOANS = [makeLoan(1, { name: "Auto" }), makeLoan(2, { name: "Travaux" })];
const START = "2026-01";
const CURRENT = "2026-05";

function renderForm() {
  const months = checkInMonths(START, CURRENT);
  render(
    <CheckInForm
      months={months}
      values={Object.fromEntries(months.map((m) => [m, prefillForm(m, undefined, LOANS)]))}
      existing={[]}
      planned={{}}
      loans={LOANS.map((l) => ({ id: l.id, label: l.name ?? l.id }))}
    />,
  );
  return userEvent.setup();
}

/** Labels end with an aria-hidden "*" on required fields. */
const field = (label: string) => screen.getByLabelText((text) => text === label || text === `${label}*`);

async function fillAllRequired(user: ReturnType<typeof userEvent.setup>, skip?: string) {
  const values: Record<string, string> = {
    "Épargne déménagement": "1 200",
    "Fonds d’urgence": "3 000,50",
    "Épargne libre": "0",
    Auto: "4 100,25",
    Travaux: "9 999",
  };
  for (const [label, value] of Object.entries(values)) {
    if (label !== skip) await user.type(field(label), value);
  }
}

beforeEach(() => {
  // The action checks the month against the current month (Europe/Paris): pin the clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
  mocks.repo = createRepositoryMock(makeSnapshot({ settings: makeSettings({ startMonth: START }), loans: LOANS }));
  mocks.notify.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CheckInForm", () => {
  it("requires every savings balance", async () => {
    const user = renderForm();
    await fillAllRequired(user, "Fonds d’urgence");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mois" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Certains champs sont à corriger.");
    expect(screen.getAllByText("Montant requis")).toHaveLength(1);
    expect(field("Fonds d’urgence").getAttribute("aria-invalid")).toBe("true");
    expect(field("Fonds d’urgence").getAttribute("aria-describedby")).toBe("suivi-emergencySavings-error");
    expect(field("Épargne déménagement").getAttribute("aria-invalid")).toBeNull();
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("requires every loan balance", async () => {
    const user = renderForm();
    await fillAllRequired(user, "Travaux");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mois" }));

    await screen.findByRole("alert");
    expect(screen.getAllByText("Montant requis")).toHaveLength(1);
    expect(field("Travaux").getAttribute("aria-invalid")).toBe("true");
    expect(field("Auto").getAttribute("aria-invalid")).toBeNull();
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
  });

  it("flags every empty required field when nothing is entered", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Enregistrer le mois" }));

    await screen.findByRole("alert");
    expect(screen.getAllByText("Montant requis")).toHaveLength(5);
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
  });

  it("saves a complete check-in with the balances in cents per loan", async () => {
    const user = renderForm();
    await fillAllRequired(user);
    await user.type(field("Revenus réels"), "2 500");
    await user.click(screen.getByRole("button", { name: "Enregistrer le mois" }));

    await waitFor(() => expect(mocks.repo?.saveActual).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveActual).toHaveBeenCalledWith({
      month: CURRENT,
      income: 250_000,
      expenses: null,
      movingSavings: 120_000,
      emergencySavings: 300_050,
      freeSavings: 0,
      loanBalances: [
        { loanId: "loan-1", balance: 410_025 },
        { loanId: "loan-2", balance: 999_900 },
      ],
    });
    expect((await screen.findByRole("status")).textContent).toContain("Mois de mai 2026 enregistré.");
    expect(screen.queryByText("Montant requis")).toBeNull();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
});
