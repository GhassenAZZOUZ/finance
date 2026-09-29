/**
 * Check-in history (/suivi, SPEC §8.2/D16): per-month cards and the desktop table show actual vs
 * planned values with their gaps (colour never the only cue), the plan version a month was compared
 * with, the budget info, and deletion; the side list shows every open month with its state.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { History, HistoryList } from "@/app/(app)/suivi/history";
import type { HistoryEntry } from "@/app/(app)/suivi/logic";
import type { MonthlyActual } from "@/lib/domain/types";
import type { ActualComparison } from "@/lib/engine";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockReset();
});
afterEach(cleanup);

/** Text with the non-breaking spaces of the French number format normalised. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const euros = (cents: number) => plain(formatEuros(cents));

function comparison(month: string, overrides: Partial<ActualComparison> = {}): ActualComparison {
  return {
    month,
    planIndex: 1,
    actualDebt: 450_000,
    plannedDebt: 400_000,
    debtGap: 50_000,
    actualSavings: 99_500,
    plannedSavings: 100_000,
    savingsGap: -500,
    movingGoalPct: 0.25,
    debtRepaidPct: 0.4,
    status: "mixed",
    incomeGap: null,
    expensesGap: null,
    ...overrides,
  };
}

function actual(month: string, overrides: Partial<MonthlyActual> = {}): MonthlyActual {
  return {
    id: `act-${month}`,
    month,
    income: null,
    expenses: null,
    movingSavings: 0,
    emergencySavings: 0,
    freeSavings: 0,
    loanBalances: [],
    goalBalances: [],
    frozen: null,
    ...overrides,
  };
}

const MARCH: HistoryEntry = {
  comparison: comparison("2027-03", { incomeGap: 2_000, expensesGap: -3_000 }),
  actual: actual("2027-03", {
    income: 302_000,
    expenses: 117_000,
    frozen: { plannedDebt: 400_000, plannedSavings: 100_000, plannedIncome: 300_000, plannedExpenses: 120_000, planStartMonth: "2027-01" },
  }),
};
const FEBRUARY: HistoryEntry = {
  comparison: comparison("2027-02", {
    plannedDebt: null,
    debtGap: null,
    plannedSavings: null,
    savingsGap: null,
    status: null,
  }),
  actual: actual("2027-02"),
};

const card = (month: RegExp) => screen.getByRole("article", { name: month });

describe("History", () => {
  it("says there is nothing yet", () => {
    render(<History entries={[]} />);
    expect(screen.getByText(/Aucune saisie pour l’instant/)).toBeTruthy();
  });

  it("shows a card per month with actual vs planned values and gaps, colour never the only cue", () => {
    render(<History entries={[MARCH, FEBRUARY]} />);
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual(["suivi-card-2027-03", "suivi-card-2027-02"]);

    const march = within(card(/mars 2027/));
    expect(march.getByText("Mitigé")).toBeTruthy();
    const values = (term: string) => plain(march.getByText(term).nextElementSibling?.textContent);
    expect(values("Dettes réelles")).toBe(euros(450_000));
    expect(values("Dettes prévues")).toBe(euros(400_000));
    // Debt 500 € above plan: out of tolerance. Savings 5 € below: within the 10 € tolerance.
    expect(values("Écart dettes")).toBe(`+${euros(50_000)}(hors tolérance)`);
    expect(values("Écart épargne")).toBe(`${euros(-500)}(dans la tolérance)`);
  });

  it("shows — when a month has no planned values (outside the plan) and no status", () => {
    render(<History entries={[FEBRUARY]} />);
    const feb = within(card(/février 2027/));
    const values = (term: string) => plain(feb.getByText(term).nextElementSibling?.textContent);
    expect(values("Dettes prévues")).toBe("—");
    expect(values("Écart dettes")).toBe("—");
    expect(values("Écart épargne")).toBe("—");
    expect(feb.queryByText(/Dans les temps|En retard|Mitigé/)).toBeNull();
  });

  it("names the plan a frozen month was compared with (SPEC D16), nothing for older entries", () => {
    render(<History entries={[MARCH, FEBRUARY]} />);
    expect(within(card(/mars 2027/)).getByText("Comparé au plan démarrant en janv. 2027")).toBeTruthy();
    expect(within(card(/février 2027/)).queryByText(/Comparé au plan/)).toBeNull();
  });

  it("shows the progress meters, named, with their percentage", () => {
    render(<History entries={[MARCH]} />);
    const march = within(card(/mars 2027/));
    const meter = (name: string) => plain(march.getByRole("progressbar", { name }).parentElement?.textContent);
    expect(meter("% objectif déménagement")).toBe("% objectif déménagement25 %");
    expect(meter("% dettes remboursées")).toBe("% dettes remboursées40 %");
  });

  it("shows the typed income and expenses as information only", () => {
    render(<History entries={[MARCH, FEBRUARY]} />);
    const budget = plain(within(card(/mars 2027/)).getByText("Budget (pour information)").parentElement?.textContent);
    expect(budget).toContain(`Revenus : ${euros(302_000)} (écart +${euros(2_000)})`);
    expect(budget).toContain(`Dépenses : ${euros(117_000)} (écart ${euros(-3_000)})`);
    expect(within(card(/février 2027/)).getByText("Non renseigné")).toBeTruthy();
  });

  it("lays the same months out in the desktop table, newest first", () => {
    render(<History entries={[MARCH, FEBRUARY]} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => plain(within(r).getByRole("rowheader").textContent))).toEqual([
      "mars 2027Comparé au plan démarrant en janv. 2027",
      "février 2027",
    ]);
    const [debt, savings] = within(rows[0]!).getAllByRole("cell").map((c) => plain(c.textContent));
    expect(debt).toBe(`${euros(450_000)} réel${euros(400_000)} prévuécart +${euros(50_000)}(hors tolérance)`);
    expect(savings).toBe(`${euros(99_500)} réelle${euros(100_000)} prévueécart ${euros(-500)}(dans la tolérance)`);
    expect(plain(within(rows[1]!).getAllByRole("cell")[0]!.textContent)).toBe(`${euros(450_000)} réel— prévuécart —`);
  });

  it("deletes a month after an inline confirmation", async () => {
    render(<History entries={[MARCH]} />);
    const user = userEvent.setup();
    await user.click(within(card(/mars 2027/)).getByRole("button", { name: "Supprimer la saisie de mars 2027" }));
    expect(mocks.repo!.deleteActual).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await vi.waitFor(() => expect(mocks.repo!.deleteActual).toHaveBeenCalledWith("2027-03"));
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
});

describe("HistoryList", () => {
  it("says there is nothing yet", () => {
    render(<HistoryList months={[]} entries={[]} currentMonth="2027-04" />);
    expect(screen.getByText("Aucune saisie pour l’instant.")).toBeTruthy();
  });

  it("lists every open month and every entry, newest first, with its state", () => {
    const old: HistoryEntry = { comparison: comparison("2026-12", { status: "onTrack", debtGap: -1_000, savingsGap: 0 }), actual: actual("2026-12") };
    render(<HistoryList months={["2027-04", "2027-03", "2027-02", "2027-01"]} entries={[MARCH, FEBRUARY, old]} currentMonth="2027-04" />);
    const items = screen.getAllByRole("listitem").map((li) => plain(li.textContent));
    expect(items).toEqual([
      "avril 2027en cours",
      `mars 2027MitigéDettes ${euros(450_000)} (+${euros(50_000)}) · Épargne ${euros(99_500)} (${euros(-500)})`,
      `février 2027—Dettes ${euros(450_000)} (—) · Épargne ${euros(99_500)} (—)`,
      "janvier 2027à saisir",
      // Before the open months (e.g. before a re-based plan's start): still listed.
      `décembre 2026Dans les tempsDettes ${euros(450_000)} (${euros(-1_000)}) · Épargne ${euros(99_500)} (${euros(0)})`,
    ]);
  });
});
