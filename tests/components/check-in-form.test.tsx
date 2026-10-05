/**
 * CheckInForm (/suivi): every row of the month (#72), savings and loan balances are required; a
 * complete form saves cents per row and per loan, with a copy of each row's budget and the plan's
 * values for that month frozen alongside (SPEC D16).
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLineTotals, checkInMonths, prefillForm } from "@/app/(app)/suivi/logic";
import { OTHER_EXPENSE_KEY, OTHER_INCOME_KEY, checkInRows } from "@/lib/domain/actual-lines";
import { plannedDeposits } from "@/lib/domain/deposits";
import { computePlan } from "@/lib/domain/plan";
import { frozenFor } from "@/lib/domain/rebase";
import type { BudgetLine } from "@/lib/domain/types";
import { CheckInForm } from "@/app/(app)/suivi/check-in-form";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));

const line = (id: string, category: BudgetLine["category"], label: string, amount: number): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const LINES = [line("salary", "income", "Salaire", 280_000), line("rent", "fixed", "Loyer", 85_000), line("food", "variable", "Courses", 40_000)];
const LOANS = [makeLoan(1, { name: "Auto" }), makeLoan(2, { name: "Travaux" })];
const START = "2026-01";
const CURRENT = "2026-05";
const SNAPSHOT = makeSnapshot({
  settings: makeSettings({ startMonth: START }),
  lines: LINES,
  exceptions: [{ id: "trip", month: CURRENT, kind: "expense", label: "Vacances", amount: 90_000 }],
  loans: LOANS,
});
const ROWS = (month: string) => checkInRows(SNAPSHOT.lines, SNAPSHOT.exceptions, SNAPSHOT.settings!, month);

function renderForm() {
  const months = checkInMonths(START, CURRENT);
  const rows = Object.fromEntries(months.map((m) => [m, ROWS(m)]));
  render(
    <CheckInForm
      months={months}
      values={Object.fromEntries(months.map((m) => [m, prefillForm(m, undefined, LOANS, SNAPSHOT.goals, rows[m])]))}
      rows={rows}
      existing={[]}
      planned={{}}
      loans={LOANS.map((l) => ({ id: l.id, label: l.name ?? l.id }))}
      goals={SNAPSHOT.goals.map((g) => ({ id: g.id, label: g.name }))}
    />,
  );
  // No timer between keystrokes: these tests type a whole month, which timed out under load (5 s).
  return userEvent.setup({ delay: null });
}

/** Labels end with an aria-hidden "*" on required fields. */
const field = (label: string) => screen.getByLabelText((text) => text === label || text === `${label}*`);
const group = (name: string) => screen.getByRole("group", { name });

async function fillAllRequired(user: ReturnType<typeof userEvent.setup>, skip?: string) {
  const values: Record<string, string> = {
    Salaire: "2 850",
    "Autres revenus (hors budget)": "0",
    Loyer: "850",
    Courses: "460",
    Vacances: "880",
    "Autres dépenses (hors budget)": "0",
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
  mocks.repo = createRepositoryMock(SNAPSHOT);
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
    await user.click(screen.getByRole("button", { name: "Enregistrer mai 2026" }));

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
    await user.click(screen.getByRole("button", { name: "Enregistrer mai 2026" }));

    await screen.findByRole("alert");
    expect(screen.getAllByText("Montant requis")).toHaveLength(1);
    expect(field("Travaux").getAttribute("aria-invalid")).toBe("true");
    expect(field("Auto").getAttribute("aria-invalid")).toBeNull();
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
  });

  it("AC-01 (#72) — requires every row of the month", async () => {
    const user = renderForm();
    await fillAllRequired(user, "Courses");
    await user.click(screen.getByRole("button", { name: "Enregistrer mai 2026" }));

    await screen.findByRole("alert");
    expect(screen.getAllByText("Montant requis")).toHaveLength(1);
    expect(field("Courses").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
  });

  it("flags every empty required field when nothing is entered", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Enregistrer mai 2026" }));

    await screen.findByRole("alert");
    // 6 rows, 3 savings, 2 loans.
    expect(screen.getAllByText("Montant requis")).toHaveLength(11);
    expect(mocks.repo?.saveActual).not.toHaveBeenCalled();
  });

  it("AC-01 (#72) — lists the month's rows by group with their budget", () => {
    renderForm();
    const labels = (name: string) => within(group(name)).getAllByRole("textbox").map((i) => i.getAttribute("name"));
    expect(labels("Revenus")).toEqual(["line.salary", `line.${OTHER_INCOME_KEY}`]);
    expect(labels("Charges fixes")).toEqual(["line.rent"]);
    expect(labels("Dépenses variables")).toEqual(["line.food", "line.trip", `line.${OTHER_EXPENSE_KEY}`]);
    expect(within(group("Charges fixes")).getByText("850,00 €", { exact: false })).toBeTruthy();
  });

  it("AC-02 (#72) — « Tout comme prévu » fills the empty rows; the gap says over budget, not by colour alone", async () => {
    const user = renderForm();
    await user.type(field("Courses"), "460");
    await user.click(screen.getByRole("button", { name: "Tout comme prévu : Dépenses variables" }));
    expect((field("Courses") as HTMLInputElement).value).toBe("460");
    expect((field("Vacances") as HTMLInputElement).value).toBe("900,00");
    expect((field("Autres dépenses (hors budget)") as HTMLInputElement).value).toBe("0,00");
    const gap = document.getElementById("suivi-line-food-gap")!;
    expect(gap.textContent).toMatch(/\+60,00\s€/);
    expect(gap.textContent).toContain("(hors tolérance)");

    await user.click(screen.getByRole("button", { name: "Comme prévu : Loyer" }));
    expect((field("Loyer") as HTMLInputElement).value).toBe("850,00");
  });

  const PLANNED = plannedDeposits(computePlan(SNAPSHOT, CURRENT)!.result, SNAPSHOT.settings!, SNAPSHOT.goals, CURRENT);

  it("AC-03 / AC-05 (#72) — saves every row with a copy of its budget, and the totals derived from them", async () => {
    const user = renderForm();
    await fillAllRequired(user);
    await user.clear(field("Autres dépenses (hors budget)"));
    await user.type(field("Autres dépenses (hors budget)"), "300");
    expect(screen.getByText(/Total dépenses/).textContent).toMatch(/2\s490,00\s€/);
    await user.click(screen.getByRole("button", { name: "Enregistrer mai 2026" }));

    await waitFor(() => expect(mocks.repo?.saveActual).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveActual).toHaveBeenCalledWith({
      month: CURRENT,
      income: 285_000,
      expenses: 249_000,
      lines: [
        { kind: "line", direction: "income", category: "income", budgetLineId: "salary", exceptionId: null, label: "Salaire", planned: 280_000, actual: 285_000 },
        { kind: "other", direction: "income", category: null, budgetLineId: null, exceptionId: null, label: "Autres revenus (hors budget)", planned: 0, actual: 0 },
        { kind: "line", direction: "expense", category: "fixed", budgetLineId: "rent", exceptionId: null, label: "Loyer", planned: 85_000, actual: 85_000 },
        { kind: "line", direction: "expense", category: "variable", budgetLineId: "food", exceptionId: null, label: "Courses", planned: 40_000, actual: 46_000 },
        { kind: "exception", direction: "expense", category: null, budgetLineId: null, exceptionId: "trip", label: "Vacances", planned: 90_000, actual: 88_000 },
        { kind: "other", direction: "expense", category: null, budgetLineId: null, exceptionId: null, label: "Autres dépenses (hors budget)", planned: 0, actual: 30_000 },
      ],
      // Savings are the month's deposits (SPEC D33, #73): the balances are computed, not stored.
      deposits: [
        { pot: "goal", goalId: "goal-primary", goalName: "Déménagement", planned: PLANNED.goals["goal-primary"], amount: 120_000 },
        { pot: "emergency", goalId: null, goalName: null, planned: PLANNED.emergency, amount: 300_050 },
        { pot: "free", goalId: null, goalName: null, planned: PLANNED.free, amount: 0 },
      ],
      emergencySavings: 0,
      freeSavings: 0,
      goalBalances: [],
      loanBalances: [
        { loanId: "loan-1", balance: 410_025 },
        { loanId: "loan-2", balance: 999_900 },
      ],
      frozen: frozenFor(CURRENT, computePlan(SNAPSHOT, CURRENT)!, undefined),
    });
    // The frozen values are the plan's expectation for that month, tagged with the plan version.
    const saved = mocks.repo?.saveActual.mock.calls[0]?.[0];
    expect(saved?.frozen).toEqual(expect.objectContaining({ planStartMonth: START }));
    expect(saved?.frozen?.plannedSavings).toEqual(expect.any(Number));
    expect(saved?.frozen?.plannedDebt).toBeGreaterThan(0);
    expect((await screen.findByRole("status")).textContent).toContain("Mois de mai 2026 enregistré.");
    expect(screen.queryByText("Montant requis")).toBeNull();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("AC-07 (#72) — a check-in already saved comes back with its rows", () => {
    const rows = ROWS(CURRENT);
    const form = prefillForm(CURRENT, {
      id: "a",
      month: CURRENT,
      income: 285_000,
      expenses: 0,
      emergencySavings: 0,
      freeSavings: 0,
      loanBalances: [],
      goalBalances: [],
      frozen: null,
      lines: [{ kind: "line", direction: "expense", category: "variable", budgetLineId: "food", exceptionId: null, label: "Courses", planned: 40_000, actual: 46_000 }],
    }, LOANS, [], rows);
    expect(form.lines?.find((l) => l.key === "food")?.actual).toBe("460,00");
    // A row not saved then (new line or older check-in) stays to enter.
    expect(form.lines?.find((l) => l.key === "rent")?.actual).toBe("");
  });
});

describe("applyLineTotals (AC-06, #72)", () => {
  it("puts the statement's total in every budget line row, 0 without operations, and leaves the others as typed", () => {
    const rows = ROWS(CURRENT);
    const lines = rows.map((r) => ({ key: r.key, actual: r.key === "trip" ? "880" : "" }));
    const applied = applyLineTotals(lines, rows, [{ budgetLineId: "food", actual: 41_230 }]);
    expect(Object.fromEntries(applied.map((l) => [l.key, l.actual]))).toEqual({
      salary: "0,00",
      [OTHER_INCOME_KEY]: "",
      rent: "0,00",
      food: "412,30",
      trip: "880",
      [OTHER_EXPENSE_KEY]: "",
    });
  });
});
