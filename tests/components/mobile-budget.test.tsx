/** Mobile Budget (issue #111): grouped lists, a sheet per line saving the full budget, tabs. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetView } from "@/app/(app)/budget/view";
import { MobileBudget } from "@/app/(app)/budget/mobile-budget";
import type { BudgetLine } from "@/lib/domain/types";
import { type RepositoryMock, createRepositoryMock, makeSettings, makeSnapshot } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  getSession: vi.fn(),
  snapshot: null as unknown,
}));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { getSession: mocks.getSession } }) }));
vi.mock("@/components/app/finance-provider", () => ({ useFinance: () => ({ snapshot: mocks.snapshot, plan: null }) }));

const SETTINGS = makeSettings();
const line = (id: string, category: BudgetLine["category"], label: string, amount: number, endMonth: string | null = null): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth,
});
const LINES: BudgetLine[] = [
  line("l-income", "income", "Salaire", 300_000),
  line("l-rent", "fixed", "Loyer", 85_000),
  line("l-net", "fixed", "Internet / mobile", 4_500, "2026-12"),
  line("l-zero-1", "fixed", "Assurance", 0),
  line("l-zero-2", "fixed", "Box", 0),
  line("l-food", "variable", "Courses", 40_000),
];

function phone(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: () => {}, removeEventListener: () => {} }) as never;
}

function renderBudget(settings = SETTINGS) {
  render(<MobileBudget settings={settings} lines={LINES} loans={[]} exceptions={[]} goals={[]} currentMonth="2026-09" />);
  return userEvent.setup({ delay: null });
}

const fixed = () => screen.getByRole("group", { name: /^Charges fixes/ });
const savedLines = () => mocks.repo!.saveBudget.mock.calls[0]![1];

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
});
afterEach(() => {
  cleanup();
  phone(false);
});

describe("MobileBudget", () => {
  it("AC-01: lists the lines by group with the group total and the period", () => {
    renderBudget();
    expect(within(fixed()).getByRole("heading").textContent).toMatch(/Charges fixes\s*895,00\s€/);
    expect(within(fixed()).getByRole("button", { name: /Loyer\s*850,00\s€/ })).toBeTruthy();
    expect(within(fixed()).getByRole("button", { name: /Internet \/ mobile/ }).textContent).toContain("jusqu’à déc. 2026");
    expect(screen.getByRole("group", { name: /Mensualités de crédit/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  });

  it("AC-05: 0 € lines are collapsed behind « Afficher »", async () => {
    const user = renderBudget();
    expect(within(fixed()).getByText(/2 lignes à 0 € masquées/)).toBeTruthy();
    expect(within(fixed()).queryByRole("button", { name: /Assurance/ })).toBeNull();
    await user.click(within(fixed()).getByRole("button", { name: /^Afficher les 2 lignes/ }));
    expect(within(fixed()).getByRole("button", { name: /Assurance/ })).toBeTruthy();
    expect(within(fixed()).getByRole("button", { name: /Box/ })).toBeTruthy();
  });

  it("AC-02: tapping a line opens its sheet focused on the amount; Escape and × close it without saving", async () => {
    const user = renderBudget();
    const loyer = within(fixed()).getByRole("button", { name: /Loyer/ });
    await user.click(loyer);
    const sheet = screen.getByRole("dialog", { name: "Modifier « Loyer »" });
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(within(sheet).getByLabelText("Montant mensuel (€)"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(loyer);

    await user.click(loyer);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.repo!.saveBudget).not.toHaveBeenCalled();
  });

  it("keeps the focus inside the sheet", async () => {
    const user = renderBudget();
    await user.click(within(fixed()).getByRole("button", { name: /Loyer/ }));
    const sheet = screen.getByRole("dialog");
    const save = within(sheet).getByRole("button", { name: "Enregistrer" });
    save.focus();
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Fermer" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });

  it("AC-03: the new margin follows the amount; Save sends the full budget once and closes the sheet", async () => {
    const user = renderBudget();
    await user.click(within(fixed()).getByRole("button", { name: /Loyer/ }));
    const sheet = screen.getByRole("dialog");
    // 3 000 − 850 − 45 − 400 = 1 705 € in September 2026; the rent at 900 € → 1 655 €.
    expect(within(sheet).getByText(/Nouvelle marge/).textContent).toMatch(/1\s705,00\s€/);
    const amount = within(sheet).getByLabelText("Montant mensuel (€)");
    await user.clear(amount);
    await user.type(amount, "900");
    expect(within(sheet).getByText(/Nouvelle marge/).textContent).toMatch(/1\s655,00\s€/);
    await user.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.repo!.saveBudget).toHaveBeenCalledTimes(1));
    expect(savedLines()).toHaveLength(LINES.length);
    expect(savedLines()).toContainEqual(expect.objectContaining({ id: "l-rent", label: "Loyer", amount: 90_000 }));
    expect(savedLines()).toContainEqual(expect.objectContaining({ id: "l-net", endMonth: "2026-12" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("« Loyer » a été enregistrée.");
  });

  it("AC-04: deleting asks for an inline confirmation; only that tap deletes", async () => {
    const user = renderBudget();
    await user.click(within(fixed()).getByRole("button", { name: /Loyer/ }));
    const sheet = screen.getByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Supprimer" }));
    expect(mocks.repo!.saveBudget).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(mocks.repo!.saveBudget).toHaveBeenCalledTimes(1));
    expect(savedLines()).toHaveLength(LINES.length - 1);
    expect(savedLines().some((l) => l.id === "l-rent")).toBe(false);
  });

  it("adds a line from its group with a period", async () => {
    const user = renderBudget();
    await user.click(within(fixed()).getByRole("button", { name: "Ajouter une charge" }));
    const sheet = screen.getByRole("dialog", { name: "Ajouter une charge" });
    await user.type(within(sheet).getByLabelText("Montant mensuel (€)"), "30");
    await user.type(within(sheet).getByLabelText("Libellé"), "Salle de sport");
    await user.click(within(sheet).getByRole("button", { name: "À partir de…" }));
    await user.type(within(sheet).getByLabelText("À partir de"), "2026-11");
    await user.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.repo!.saveBudget).toHaveBeenCalledTimes(1));
    expect(savedLines()).toContainEqual(expect.objectContaining({ category: "fixed", label: "Salle de sport", amount: 3_000, startMonth: "2026-11", endMonth: null }));
  });

  it("keeps the sheet open with the error when the save is refused", async () => {
    const user = renderBudget();
    await user.click(within(fixed()).getByRole("button", { name: /Loyer/ }));
    const sheet = screen.getByRole("dialog");
    const amount = within(sheet).getByLabelText("Montant mensuel (€)");
    await user.clear(amount);
    await user.type(amount, "-5");
    await user.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(amount.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.repo!.saveBudget).not.toHaveBeenCalled();
  });

  it("the tabs show the one-off exceptions and the goals with the plan parameters", async () => {
    const user = renderBudget();
    await user.click(screen.getByRole("tab", { name: "Objectifs" }));
    expect(screen.getByRole("tab", { name: "Objectifs" }).getAttribute("aria-selected")).toBe("true");
    const goals = screen.getByRole("tabpanel", { name: "Objectifs" });
    expect(within(goals).getByRole("group", { name: "Paramètres du plan" })).toBeTruthy();
    expect(within(goals).getByRole("button", { name: "Enregistrer" })).toBeTruthy();
    expect(within(goals).queryByRole("group", { name: /^Charges fixes/ })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Ponctuel" }));
    expect(within(screen.getByRole("tabpanel", { name: "Ponctuel" })).getByRole("heading", { name: "Exceptions ponctuelles" })).toBeTruthy();
  });

  it("opens on the parameters on a first visit", () => {
    renderBudget(null as never);
    expect(screen.getByRole("tab", { name: "Objectifs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("BudgetView mounts it on a phone only", () => {
    mocks.snapshot = makeSnapshot({ settings: SETTINGS, lines: LINES });
    phone(true);
    render(<BudgetView />);
    expect(screen.getByRole("tablist", { name: "Sections du budget" })).toBeTruthy();
    cleanup();
    phone(false);
    render(<BudgetView />);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
