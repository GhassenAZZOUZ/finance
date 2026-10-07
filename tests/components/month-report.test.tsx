/** Monthly report as PDF (issue #145). Invented data only. */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonthReport } from "@/app/(app)/rapports/mois/month-report";
import type { ActualLine } from "@/lib/domain/actual-lines";
import type { FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { makeLoan, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({ value: null as unknown, mois: "2027-02", native: false }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => mocks.value }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ mois: mocks.mois }) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const row = (label: string, direction: "income" | "expense", planned: number, actual: number): ActualLine => ({
  kind: "line",
  direction,
  category: direction === "income" ? "income" : "variable",
  budgetLineId: label,
  exceptionId: null,
  label,
  planned,
  actual,
});
const february: MonthlyActual = {
  id: "feb",
  month: "2027-02",
  income: 300_000,
  expenses: 136_000,
  lines: [row("Salaire", "income", 300_000, 300_000), row("Loyer", "expense", 90_000, 90_000), row("Courses", "expense", 40_000, 46_000)],
  emergencySavings: 120_000,
  freeSavings: 30_000,
  goalBalances: [],
  loanBalances: [{ loanId: "loan-1", balance: 450_000 }],
  frozen: null,
};

function setup(isPro: boolean, mois = "2027-02") {
  mocks.mois = mois;
  const snapshot: FinanceSnapshot = makeSnapshot({ actuals: [february], loans: [makeLoan(1, { name: "Auto" })], isPro });
  mocks.value = { snapshot };
  render(<MonthReport />);
}

beforeEach(() => {
  mocks.native = false;
});
afterEach(cleanup);

describe("MonthReport", () => {
  it("shows the month's verdict, income and expenses per line, savings and loans", () => {
    setup(true);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("février 2027");
    const expenses = screen.getByRole("region", { name: "Dépenses : réel et budget" });
    const courses = within(expenses).getByRole("row", { name: /Courses/ });
    expect(courses.textContent).toMatch(/400,00\s€.*460,00\s€.*\+60,00\s€/);
    expect(within(screen.getByRole("region", { name: "Épargne et crédits" })).getByText("Auto")).toBeTruthy();
    expect(screen.getByText("Fonds d’urgence")).toBeTruthy();
  });

  it("« Télécharger en PDF » opens the browser's print dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    setup(true);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Télécharger en PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("explains in the Android app that the PDF comes from the website", () => {
    mocks.native = true;
    setup(true);
    expect(screen.queryByRole("button", { name: "Télécharger en PDF" })).toBeNull();
    expect(screen.getByText(/se télécharge depuis le site web/)).toBeTruthy();
  });

  it("is Pro only, and says when the month has no check-in", () => {
    setup(false);
    expect(screen.getByText(/réservé à Boussole Pro/)).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    cleanup();
    setup(true, "2027-05");
    expect(screen.getByText(/Aucun suivi enregistré pour ce mois/)).toBeTruthy();
  });
});
