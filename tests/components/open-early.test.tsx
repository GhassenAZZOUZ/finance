/**
 * Early check-in (issue #61, SPEC D29): the next month opens once its first income is paid; its loans
 * are not entered but taken from the plan, and the server recomputes both from the saved data.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInForm } from "@/app/(app)/suivi/check-in-form";
import { earlyLoanBalances, plannedForMonth, prefillForm } from "@/app/(app)/suivi/logic";
import { checkInRows } from "@/lib/domain/actual-lines";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock, makeLoan, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

const LOANS = [makeLoan(1, { name: "Auto" })];
const salary = (payday: Partial<BudgetLine>): BudgetLine => ({
  id: "salary",
  category: "income",
  label: "Salaire",
  amount: 300_000,
  position: 0,
  startMonth: null,
  endMonth: null,
  ...payday,
});
const snapshotWith = (line: BudgetLine): FinanceSnapshot =>
  makeSnapshot({ settings: makeSettings({ startMonth: "2026-01", earlyRepaymentPct: 0 }), loans: LOANS, lines: [line] });

/** The form as the Suivi page builds it for June 2026, opened early (or forged). */
function renderJune(snapshot: FinanceSnapshot, early: boolean) {
  const plan = computePlan(snapshot, "2026-05")!;
  const months = ["2026-06", "2026-05"];
  const rows = Object.fromEntries(months.map((m) => [m, checkInRows(snapshot.lines, snapshot.exceptions, snapshot.settings!, m)]));
  const values = Object.fromEntries(months.map((m) => [m, prefillForm(m, undefined, LOANS, snapshot.goals, rows[m])]));
  if (early) values["2026-06"] = { ...values["2026-06"]!, loanBalances: earlyLoanBalances(plan.result, "2026-01", "2026-06", ["loan-1"]) };
  render(
    <CheckInForm
      months={months}
      initialMonth="2026-06"
      values={values}
      rows={rows}
      existing={[]}
      currentMonth="2026-05"
      earlyMonth={early ? "2026-06" : null}
      planned={Object.fromEntries(months.map((m) => [m, plannedForMonth(plan.result, "2026-01", m, snapshot.goals)]))}
      loans={LOANS.map((l) => ({ id: l.id, label: l.name ?? l.id }))}
      goals={snapshot.goals.map((g) => ({ id: g.id, label: g.name }))}
    />,
  );
  return { user: userEvent.setup({ delay: null }), plan };
}

const field = (label: string) => screen.getByLabelText((text) => text === label || text === `${label}*`);

async function fillSavings(user: ReturnType<typeof userEvent.setup>) {
  // Income and expenses as planned (#72).
  for (const button of screen.getAllByRole("button", { name: /^Tout comme prévu/ })) await user.click(button);
  await user.type(field("Épargne déménagement"), "100");
  await user.type(field("Fonds d’urgence"), "200");
  await user.type(field("Épargne libre"), "0");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 28 May 2026, midday in Paris.
  vi.setSystemTime(new Date("2026-05-28T10:00:00Z"));
  mocks.notify.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("early check-in", () => {
  it("AC-09 — takes the loans from the plan (read-only) and saves them", async () => {
    const snapshot = snapshotWith(salary({ paydayDay: 27, paydayPreviousMonth: true }));
    mocks.repo = createRepositoryMock(snapshot);
    const { user, plan } = renderJune(snapshot, true);
    const june = plan.result.months.find((m) => m.month === "2026-06")!;
    const planned = june.loans[0]!.endBalance;
    expect(planned).toBeGreaterThan(0);

    expect(screen.getByText(/Mois ouvert en avance/)).toBeTruthy();
    expect(screen.queryByLabelText((text) => text.startsWith("Auto"))).toBeNull();
    const shown = screen.getByText((_, el) => el?.tagName === "SPAN" && (el.textContent ?? "").startsWith(formatEuros(planned)));
    expect(shown.textContent).toContain("solde après l’échéance de juin 2026, repris du plan");
    expect(screen.getByRole("button", { name: /^juin 2026/i, pressed: true }).textContent).toContain("ouvert en avance");

    await fillSavings(user);
    await user.click(screen.getByRole("button", { name: "Enregistrer juin 2026" }));
    await waitFor(() => expect(mocks.repo!.saveActual).toHaveBeenCalledTimes(1));
    const saved = mocks.repo!.saveActual.mock.calls[0]![0];
    expect(saved.month).toBe("2026-06");
    expect(saved.loanBalances).toEqual([{ loanId: "loan-1", balance: planned }]);
    expect(saved.frozen?.plannedDebt).toBe(june.remainingDebt);
  });

  it("AC-03 — the server refuses the next month while no income is paid", async () => {
    // Paid on the 1st of June: on 28 May, June is still closed; a forged form for June is refused.
    const snapshot = snapshotWith(salary({}));
    mocks.repo = createRepositoryMock(snapshot);
    const { user } = renderJune(snapshot, false);
    await fillSavings(user);
    await user.type(field("Auto"), "1 000");
    await user.click(screen.getByRole("button", { name: "Enregistrer juin 2026" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Certains champs sont à corriger.");
    expect(screen.getByText("Impossible de saisir un mois futur")).toBeTruthy();
    expect(mocks.repo!.saveActual).not.toHaveBeenCalled();
  });
});
