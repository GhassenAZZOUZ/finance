/**
 * PlanTable (/plan, SPEC D11/D14/D23): grouped headers, one row group per year with its phases,
 * amounts per month, and the milestone / exception chips of a row.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { planPhases } from "@/app/(app)/_dashboard/logic";
import type { PlanMilestones } from "@/app/(app)/plan/milestones";
import { PlanTable } from "@/app/(app)/plan/plan-table";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { makeLoan, makeSettings, makeSnapshot } from "./helpers";

afterEach(cleanup);

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const PLAN = computePlan(
  makeSnapshot({
    settings: makeSettings({ startMonth: "2027-11", movingDeadlineMonth: "2028-03", earlyRepaymentPct: 0.5 }),
    lines: [line("salary", "income", 300_000), line("rent", "fixed", 120_000)],
    loans: [makeLoan(1, { name: "Prêt auto" })],
  }),
)!;
const MONTHS = PLAN.result.months.slice(0, 6); // 2027-11 … 2028-04
const PHASES = planPhases(PLAN.result.months);

const NO_MILESTONES: PlanMilestones = {
  movingIndex: null,
  emergencyIndex: null,
  debtFreeIndex: null,
  deadlineIndex: null,
  loanPayoffs: new Map(),
  negativeCount: 0,
  firstNegativeMonth: null,
};

/** Text with the non-breaking spaces of the French number format normalised. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

function renderTable(props: Partial<Parameters<typeof PlanTable>[0]> = {}) {
  return render(
    <PlanTable
      months={MONTHS}
      milestones={NO_MILESTONES}
      exceptions={new Map()}
      phases={PHASES}
      todayIndex={2}
      earlyRepaymentPct={0.5}
      caption="Plan mois par mois"
      {...props}
    />,
  );
}

/** Row of a month, found by the start of its header text ("déc. 2027", then its chips). */
function row(name: RegExp) {
  const header = screen.getAllByRole("rowheader").find((h) => h.getAttribute("scope") === "row" && name.test(plain(h.textContent)));
  if (!header) throw new Error(`No row for ${name}`);
  return header.closest("tr")!;
}

describe("PlanTable", () => {
  it("is a named, focusable scroll region with a captioned table and grouped headers", () => {
    renderTable();
    const region = screen.getByRole("region", { name: "Tableau du plan mois par mois" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(within(region).getByRole("table", { name: "Plan mois par mois" })).toBeTruthy();
    const groups = screen.getAllByRole("columnheader").filter((h) => h.getAttribute("scope") === "colgroup");
    expect(groups.map((g) => g.textContent)).toEqual(["Budget du mois", "① Déménag.", "② Urgence", "③ Reste du mois", "Dettes"]);
  });

  it("names the goals group after the goals when it is not the moving fund (SPEC D23)", () => {
    renderTable({ goalsName: "Voyage", primaryName: "Voyage" });
    expect(screen.getByRole("columnheader", { name: "① Voyage" })).toBeTruthy();
  });

  it("groups the months by year, each separator naming the year and its phases", () => {
    renderTable();
    const years = screen.getAllByRole("rowheader").filter((h) => h.getAttribute("scope") === "rowgroup");
    expect(years.map((y) => plain(y.textContent).slice(0, 4))).toEqual(["2027", "2028"]);
    expect(within(years[0]!.closest("tbody")!).getAllByRole("row")).toHaveLength(1 + 2);
    expect(within(years[1]!.closest("tbody")!).getAllByRole("row")).toHaveLength(1 + 4);
    expect(plain(years[0]!.textContent)).toMatch(/^2027 · \S/);
  });

  it("shows each month's amounts, with the running total under its flow", () => {
    renderTable();
    const first = MONTHS[0]!;
    const cells = within(row(/nov\. 2027/)).getAllByRole("cell").map((c) => plain(c.textContent));
    expect(cells).toHaveLength(9);
    expect(cells[0]).toBe(plain(formatEuros(first.income)));
    expect(cells[3]).toBe(plain(formatEuros(first.available)));
    expect(cells[4]).toContain(`cumul ${plain(formatEuros(first.movingCumulative))}`);
    expect(cells[8]).toBe(plain(formatEuros(first.remainingDebt)));
  });

  it("shows an empty allocation as — (0 € for screen readers)", () => {
    const months = MONTHS.map((m) => (m.index === 1 ? { ...m, toEarlyRepayment: 0 } : m));
    renderTable({ months });
    const cell = within(row(/nov\. 2027/)).getAllByRole("cell")[6]!;
    expect(cell.querySelector("[aria-hidden]")?.textContent).toBe("—");
    expect(plain(cell.querySelector(".sr-only")?.textContent)).toBe(plain(formatEuros(0)));
  });

  it("highlights today's month", () => {
    renderTable({ todayIndex: 2 });
    expect(within(row(/déc\. 2027/)).getByText("Aujourd’hui")).toBeTruthy();
    expect(screen.getAllByText("Aujourd’hui")).toHaveLength(1);
  });

  it("marks the milestones of a month with chips", () => {
    renderTable({
      milestones: {
        ...NO_MILESTONES,
        deadlineIndex: 5,
        movingIndex: 4,
        emergencyIndex: 6,
        debtFreeIndex: 6,
        loanPayoffs: new Map([[6, ["Prêt auto"]]]),
      },
      movingGoalMet: true,
      primaryName: "Déménagement",
    });
    expect(within(row(/févr\. 2028/)).getByText("Déménagement financé")).toBeTruthy();
    expect(plain(within(row(/mars 2028/)).getByText(/Date limite/).textContent)).toBe("Date limite déménagement · objectif tenu");
    const april = within(row(/avr\. 2028/));
    for (const chip of ["Prêt auto soldé", "Plus de dettes", "Fonds d’urgence complet"]) expect(april.getByText(chip)).toBeTruthy();
  });

  it("says when the deadline is missed, and names several goals together", () => {
    renderTable({
      milestones: { ...NO_MILESTONES, deadlineIndex: 5, movingIndex: 5 },
      movingGoalMet: false,
      goalsName: "Objectifs",
      primaryName: "Voyage",
    });
    const march = within(row(/mars 2028/));
    expect(plain(march.getByText(/Date limite/).textContent)).toBe("Date limite voyage · objectif non tenu");
    expect(march.getByText("Objectifs financés")).toBeTruthy();
  });

  it("marks a negative month in red, without highlighting its allocations", () => {
    const months = MONTHS.map((m) => (m.index === 3 ? { ...m, negativeBudget: true } : m));
    renderTable({ months, milestones: { ...NO_MILESTONES, movingIndex: 3 } });
    const jan = row(/janv\. 2028/);
    expect(jan.className).toContain("text-bad");
    expect(within(jan).getByText("Budget négatif")).toBeTruthy();
    expect(within(jan).getAllByRole("cell")[4]!.className).not.toContain("bg-bucket");
  });

  it("shows one-off exceptions with their total, the details for screen readers and in the tooltip", () => {
    const months = MONTHS.map((m) => (m.index === 1 ? { ...m, extraIncome: 50_000, extraExpenses: 12_000 } : m));
    renderTable({
      months,
      exceptions: new Map([
        [
          1,
          {
            income: [
              { id: "a", label: "Prime", amount: 30_000 },
              { id: "b", label: "Cadeau", amount: 20_000 },
            ],
            expense: [{ id: "c", label: "Vacances", amount: 12_000 }],
          },
        ],
      ]),
    });
    const nov = row(/nov\. 2027/);
    const income = within(nov).getByText(/2 exceptions ponctuelles/).parentElement!;
    expect(plain(income.textContent)).toContain(`Exception +${plain(formatEuros(50_000))}`);
    expect(plain(income.textContent)).toContain("(revenus en plus");
    expect(plain(income.getAttribute("title"))).toBe(plain(`Prime (${formatEuros(30_000)}), Cadeau (${formatEuros(20_000)})`));
    const expense = within(nov).getByText(/^Exception ponctuelle/).parentElement!;
    expect(plain(expense.textContent)).toContain(`Exception −${plain(formatEuros(12_000))}`);
    expect(plain(expense.textContent)).toContain("Vacances");
  });
});
