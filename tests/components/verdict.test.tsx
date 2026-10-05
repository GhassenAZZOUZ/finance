/** « Plan tenu » verdict (issue #74, SPEC D34) in the check-in, the history and the dashboard strip. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInStripCard } from "@/app/(app)/_dashboard/check-in-strip";
import { CheckInForm } from "@/app/(app)/suivi/check-in-form";
import { History } from "@/app/(app)/suivi/history";
import { plannedForMonth, prefillForm } from "@/app/(app)/suivi/logic";
import { checkInRows } from "@/lib/domain/actual-lines";
import { plannedDeposits } from "@/lib/domain/deposits";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { verdictOf } from "@/lib/domain/verdict";
import type { ActualComparison } from "@/lib/engine";
import { type RepositoryMock, createRepositoryMock, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: vi.fn() }));

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id === "salary" ? "Salaire" : id === "rent" ? "Loyer" : "Courses",
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const SNAPSHOT: FinanceSnapshot = makeSnapshot({
  settings: makeSettings({ startMonth: "2027-03", emergencyTarget: 0, emergencyExisting: 50_000, freeSavingsExisting: 0 }),
  lines: [line("salary", "income", 280_000), line("rent", "fixed", 113_000), line("food", "variable", 40_000)],
  goals: [{ id: "voyage", name: "Voyage", target: 5_000_000, deadlineMonth: "2030-12", alreadySaved: 0, priority: 1, primary: true }],
});
const MONTH = "2027-03";
const ROWS = checkInRows(SNAPSHOT.lines, SNAPSHOT.exceptions, SNAPSHOT.settings!, MONTH);

function renderForm() {
  const plan = computePlan(SNAPSHOT, MONTH)!;
  const deposits = plannedDeposits(plan.result, SNAPSHOT.settings!, SNAPSHOT.goals, MONTH);
  render(
    <CheckInForm
      months={[MONTH]}
      values={{ [MONTH]: prefillForm(MONTH, undefined, [], SNAPSHOT.goals, ROWS) }}
      rows={{ [MONTH]: ROWS }}
      existing={[]}
      planned={{
        [MONTH]: {
          ...plannedForMonth(plan.result, "2027-03", MONTH, SNAPSHOT.goals)!,
          deposits: { goals: [deposits.goals.voyage!], emergency: deposits.emergency, free: deposits.free },
          savingsBefore: 50_000,
          notEntered: [],
        },
      }}
      loans={[]}
      goals={[{ id: "voyage", label: "Voyage" }]}
    />,
  );
  return userEvent.setup({ delay: null });
}
const field = (label: string) => screen.getByLabelText((text) => text === label || text === `${label}*`);

/** A detailed check-in: groceries 80 € over, everything else as planned. */
const DETAILED: MonthlyActual = {
  id: "a",
  month: MONTH,
  income: 280_000,
  expenses: 161_000,
  lines: [
    { kind: "line", direction: "income", category: "income", budgetLineId: "salary", exceptionId: null, label: "Salaire", planned: 280_000, actual: 280_000 },
    { kind: "line", direction: "expense", category: "fixed", budgetLineId: "rent", exceptionId: null, label: "Loyer", planned: 113_000, actual: 113_000 },
    { kind: "line", direction: "expense", category: "variable", budgetLineId: "food", exceptionId: null, label: "Courses", planned: 40_000, actual: 48_000 },
  ],
  deposits: [{ pot: "goal", goalId: "voyage", goalName: "Voyage", planned: 127_000, amount: 127_000 }],
  emergencySavings: 50_000,
  freeSavings: 0,
  loanBalances: [],
  goalBalances: [{ goalId: "voyage", balance: 127_000 }],
  frozen: null,
};
const COMPARISON: ActualComparison = {
  month: MONTH,
  planIndex: 1,
  actualDebt: 0,
  plannedDebt: 0,
  debtGap: 0,
  actualSavings: 177_000,
  plannedSavings: 177_000,
  savingsGap: 0,
  movingGoalPct: 0,
  debtRepaidPct: 0,
  status: "onTrack",
  incomeGap: 0,
  expensesGap: 0,
};

beforeEach(() => {
  mocks.repo = createRepositoryMock(SNAPSHOT);
});
afterEach(cleanup);

describe("verdict in the check-in (live)", () => {
  it("says « incomplet » until every row and deposit is filled, then gives the verdict", async () => {
    const user = renderForm();
    expect(screen.getByText(/incomplet/)).toBeTruthy();
    for (const section of ["Revenus", "Charges fixes", "Dépenses variables"]) await user.click(screen.getByRole("button", { name: `Tout comme prévu : ${section}` }));
    await user.click(screen.getByRole("button", { name: "Tout comme prévu : épargne" }));
    expect(screen.getByText("Plan tenu")).toBeTruthy();
    // Overspend on groceries: partially held, the line is named.
    await user.clear(field("Courses"));
    await user.type(field("Courses"), "480");
    expect(screen.getByText("Plan partiellement tenu")).toBeTruthy();
    expect(screen.getByText(/Dépassements : Courses/)).toBeTruthy();
    expect(screen.getByText("Trajectoire provisoire")).toBeTruthy();
  });
});

describe("verdict in the history and on the dashboard (AC-06, AC-07)", () => {
  it("shows the verdict in words with its checks, and the trajectory next to it", () => {
    render(<History entries={[{ comparison: COMPARISON, actual: DETAILED }]} />);
    expect(screen.getAllByText("Plan partiellement tenu").length).toBeGreaterThan(0);
    // Each check says in words whether it is held (the icon is decorative).
    const checks = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(checks.some((t) => t.startsWith("Non tenu : Dépenses"))).toBe(true);
    expect(checks.some((t) => t.startsWith("Tenu : Revenus"))).toBe(true);
    expect(screen.getAllByText(/Dépassements : Courses/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Trajectoire/).length).toBeGreaterThan(0);
  });

  it("shows « non détaillé » for a check-in without rows or deposits", () => {
    render(<History entries={[{ comparison: COMPARISON, actual: { ...DETAILED, lines: [], deposits: undefined } }]} />);
    expect(screen.getAllByText("— (non détaillé)").length).toBeGreaterThan(0);
  });

  it("shows the verdict on the dashboard's check-in strip", () => {
    render(
      <CheckInStripCard
        slots={[{ month: MONTH, comparison: COMPARISON, state: "entered" }]}
        startMonth="2027-03"
        verdicts={{ [MONTH]: verdictOf(DETAILED) }}
      />,
    );
    expect(screen.getByText("Plan partiellement tenu")).toBeTruthy();
    expect(screen.getByText(/Trajectoire/).textContent).toContain("dans les temps");
  });
});
