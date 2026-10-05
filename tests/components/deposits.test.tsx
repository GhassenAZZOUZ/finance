/** « Épargne versée ce mois » in the check-in (issue #73, SPEC D33), with the real save action. */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInForm } from "@/app/(app)/suivi/check-in-form";
import { plannedForMonth, prefillForm } from "@/app/(app)/suivi/logic";
import { checkInRows } from "@/lib/domain/actual-lines";
import { plannedDeposits, startingBalances } from "@/lib/domain/deposits";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

const line = (id: string, category: BudgetLine["category"], amount: number): BudgetLine => ({
  id,
  category,
  label: id,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const SNAPSHOT: FinanceSnapshot = makeSnapshot({
  settings: makeSettings({ startMonth: "2027-01", emergencyTarget: 0, emergencyExisting: 50_000, freeSavingsExisting: 10_000 }),
  lines: [line("salary", "income", 300_000), line("rent", "fixed", 270_000)],
  goals: [{ id: "voyage", name: "Voyage", target: 5_000_000, deadlineMonth: "2030-12", alreadySaved: 100_000, priority: 1, primary: true }],
});
const MONTH = "2027-01";
const ROWS = checkInRows(SNAPSHOT.lines, SNAPSHOT.exceptions, SNAPSHOT.settings!, MONTH);

function renderForm(savingsInterest = 0) {
  const plan = computePlan(SNAPSHOT, MONTH)!;
  const deposits = plannedDeposits(plan.result, SNAPSHOT.settings!, SNAPSHOT.goals, MONTH);
  const start = startingBalances(SNAPSHOT.settings!, SNAPSHOT.goals);
  render(
    <CheckInForm
      months={[MONTH]}
      values={{ [MONTH]: { ...prefillForm(MONTH, undefined, [], SNAPSHOT.goals, ROWS), goalBalances: [{ goalId: "voyage", balance: "" }] } }}
      rows={{ [MONTH]: ROWS }}
      existing={[]}
      planned={{
        [MONTH]: {
          ...plannedForMonth(plan.result, "2027-01", MONTH, SNAPSHOT.goals)!,
          deposits: { goals: [deposits.goals.voyage!], emergency: deposits.emergency, free: deposits.free },
          savingsBefore: start.goals.voyage! + start.emergency + start.free,
          savingsInterest,
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
const plain = (text: string | null | undefined) => (text ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const row = (label: string) => field(label).closest("div.border-b") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-20T12:00:00Z"));
  mocks.repo = createRepositoryMock(SNAPSHOT);
  mocks.notify.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Épargne versée ce mois", () => {
  it("AC-01 — shows each pot's planned deposit, and « Tout comme prévu » fills them", async () => {
    const user = renderForm();
    expect(screen.getByText("Épargne versée ce mois")).toBeTruthy();
    expect(plain(row("Épargne voyage").textContent)).toContain(`Prévu : ${plain(formatEuros(30_000))}`);
    await user.click(screen.getByRole("button", { name: "Tout comme prévu : épargne" }));
    expect((field("Épargne voyage") as HTMLInputElement).value).toBe("300,00");
    expect((field("Fonds d’urgence") as HTMLInputElement).value).toBe("0,00");
    // 1 000 + 500 + 100 € before, + 300 € deposited: as planned.
    expect(screen.getByText(/Épargne totale en fin de mois/).textContent).toContain(formatEuros(190_000));
  });

  it("#82 AC-05 — a crediting month adds the estimated interest to the total and says so", async () => {
    const user = renderForm(3_456);
    await user.click(screen.getByRole("button", { name: "Tout comme prévu : épargne" }));
    const total = plain(screen.getByText(/Épargne totale en fin de mois/).textContent);
    expect(total).toContain(plain(formatEuros(193_456)));
    expect(total).toContain(plain(`dont ${formatEuros(3_456)} d’intérêts estimés`));
  });

  it("no interest that month: no mention", () => {
    renderForm();
    expect(screen.queryByText(/intérêts estimés/)).toBeNull();
  });

  it("AC-03 — shows a negative amount as a withdrawal", async () => {
    const user = renderForm();
    await user.type(field("Épargne libre"), "-50");
    expect(plain(row("Épargne libre").textContent)).toContain(plain(`Retrait de ${formatEuros(5_000)}`));
  });

  it("saves the deposits, and refuses a withdrawal larger than the balance", async () => {
    const user = renderForm();
    // The month's budget rows (#72) are required too.
    for (const section of ["Revenus", "Charges fixes", "Dépenses variables"]) await user.click(screen.getByRole("button", { name: `Tout comme prévu : ${section}` }));
    await user.type(field("Épargne voyage"), "300");
    await user.type(field("Fonds d’urgence"), "0");
    await user.type(field("Épargne libre"), "-150");
    await user.click(screen.getByRole("button", { name: "Enregistrer janvier 2027" }));
    expect(await screen.findByText("Le solde deviendrait négatif")).toBeTruthy();
    expect(mocks.repo!.saveActual).not.toHaveBeenCalled();

    await user.clear(field("Épargne libre"));
    await user.type(field("Épargne libre"), "-50");
    await user.click(screen.getByRole("button", { name: "Enregistrer janvier 2027" }));
    await waitFor(() => expect(mocks.repo!.saveActual).toHaveBeenCalledOnce());
    expect(mocks.repo!.saveActual.mock.calls[0]![0].deposits).toEqual([
      { pot: "goal", goalId: "voyage", goalName: "Voyage", planned: 30_000, amount: 30_000 },
      { pot: "emergency", goalId: null, goalName: null, planned: 0, amount: 0 },
      { pot: "free", goalId: null, goalName: null, planned: 0, amount: -5_000 },
    ]);
  });
});
