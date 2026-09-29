/** « Revenus de <mois> » on Suivi (issue #60, SPEC D29): expected dates and per-month exceptions. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomePaymentsCard } from "@/app/(app)/suivi/income-payments-card";
import type { BudgetLine, IncomePayment } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

const LINES: BudgetLine[] = [
  { id: "a", category: "income", label: "Salaire A", amount: 250_000, position: 0, startMonth: null, endMonth: null, paydayDay: 27, paydayPreviousMonth: true },
  { id: "b", category: "income", label: "Salaire B", amount: 180_000, position: 1, startMonth: null, endMonth: null },
  { id: "rent", category: "fixed", label: "Loyer", amount: 90_000, position: 0, startMonth: null, endMonth: null },
];

function renderCard(payments: IncomePayment[] = [], today = "2026-09-26") {
  render(<IncomePaymentsCard months={["2026-10", "2026-09"]} lines={LINES} payments={payments} today={today} />);
  return userEvent.setup();
}
const row = (label: string) => screen.getByText(label).closest("li")!;

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockReset();
});
afterEach(cleanup);

describe("IncomePaymentsCard", () => {
  it("lists next month's income lines with their expected dates (AC-01)", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: /Revenus d.octobre 2026/i })).toBeTruthy();
    expect(within(row("Salaire A")).getByText("Attendu le 27/09/2026")).toBeTruthy();
    expect(within(row("Salaire B")).getByText("Attendu le 01/10/2026")).toBeTruthy();
    expect(screen.queryByText("Loyer")).toBeNull();
  });

  it("records an exception for one income (AC-02)", async () => {
    const user = renderCard();
    fireEvent.change(within(row("Salaire A")).getByLabelText("Versé à une autre date"), { target: { value: "2026-09-26" } });
    await user.click(within(row("Salaire A")).getByRole("button", { name: "Enregistrer" }));
    expect(mocks.repo!.setIncomePayment).toHaveBeenCalledWith("2026-10", "a", "2026-09-26");
    expect(mocks.notify).toHaveBeenCalled();
    expect(within(row("Salaire A")).getByRole("status").textContent).toBe("Date enregistrée.");
  });

  it("shows a recorded date and clears it (AC-03)", async () => {
    const user = renderCard([{ month: "2026-10", budgetLineId: "a", paidOn: "2026-09-25" }]);
    expect(within(row("Salaire A")).getByText("Versé le 25/09/2026")).toBeTruthy();
    await user.click(within(row("Salaire A")).getByRole("button", { name: "Retirer" }));
    expect(mocks.repo!.setIncomePayment).toHaveBeenCalledWith("2026-10", "a", null);
  });

  it("refuses a date in the future in French (AC-04)", async () => {
    const user = renderCard();
    fireEvent.change(within(row("Salaire B")).getByLabelText("Versé à une autre date"), { target: { value: "2026-09-28" } });
    await user.click(within(row("Salaire B")).getByRole("button", { name: "Enregistrer" }));
    expect(within(row("Salaire B")).getByRole("alert").textContent).toBe("La date ne peut pas être dans le futur");
    expect(mocks.repo!.setIncomePayment).not.toHaveBeenCalled();
  });

  it("switches to an open month to correct it", async () => {
    const user = renderCard();
    await user.selectOptions(screen.getByLabelText("Mois des revenus"), "2026-09");
    expect(screen.getByRole("heading", { name: /Revenus de septembre 2026/i })).toBeTruthy();
    expect(within(row("Salaire A")).getByText("Versé le 27/08/2026")).toBeTruthy();
  });

  it("reports a failed save", async () => {
    mocks.repo!.setIncomePayment.mockRejectedValueOnce(new Error("offline"));
    const user = renderCard();
    fireEvent.change(within(row("Salaire A")).getByLabelText("Versé à une autre date"), { target: { value: "2026-09-26" } });
    await user.click(within(row("Salaire A")).getByRole("button", { name: "Enregistrer" }));
    expect((await within(row("Salaire A")).findByRole("alert")).textContent).toContain("n’a pas été enregistrée");
  });
});
