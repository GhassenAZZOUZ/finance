/** BudgetForm (/budget): negative line amounts block the save; the live preview follows the edits. */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetForm } from "@/app/(app)/budget/budget-form";
import type { BudgetLine } from "@/lib/domain/types";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock, makeSettings } from "./helpers";

const mocks = vi.hoisted(() => ({
  repo: null as RepositoryMock | null,
  notify: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/data/client-store", () => ({
  getRepository: () => mocks.repo,
  notifyDataChanged: mocks.notify,
}));
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { getSession: mocks.getSession } }),
}));

const SETTINGS = makeSettings();
const LINES: BudgetLine[] = [
  { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null },
  { id: "l-rent", category: "fixed", label: "Loyer", amount: 90_000, position: 0, startMonth: null, endMonth: null },
  { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0, startMonth: null, endMonth: null },
];

function renderForm() {
  render(<BudgetForm settings={SETTINGS} lines={LINES} loans={[]} exceptions={[]} currentMonth="2026-09" />);
  return userEvent.setup({ delay: null });
}

const amountInput = (label: string) => screen.getByLabelText(`Montant mensuel en euros (${label})`);
// Settings start in January 2026 and today is September 2026: the KPIs describe September 2026.
/** A month field of a line's period panel (only reachable once the panel is open). */
const periodInput = (line: string, field: "Début (inclus)" | "Fin (incluse)") =>
  within(screen.getByRole("group", { name: `Période de ${line}` })).getByLabelText(field);
const margin = () => screen.getByText("Marge mensuelle (sept. 2026)").nextElementSibling?.textContent;

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockClear();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
});
afterEach(cleanup);

/** What the form saves: the settings plus the yearly rates (SPEC D27), 0 when untouched. */
const SAVED_SETTINGS = { ...SETTINGS, expenseInflationRate: 0, incomeGrowthRate: 0, emergencyRate: 0, freeSavingsRate: 0 };

describe("BudgetForm", () => {
  it("leaves the goals' amounts to the goals card and links to it (SPEC D23)", () => {
    renderForm();
    const group = screen.getByRole("group", { name: "Paramètres du plan" });
    expect(within(group).queryByLabelText(/déménagement/i)).toBeNull();
    expect(within(group).getByRole("link", { name: "Objectifs d’épargne" }).getAttribute("href")).toBe("#section-goals");
  });

  it("shows the error on the negative line and does not save", async () => {
    const user = renderForm();
    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "-50");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Le montant ne peut pas être négatif")).toBeTruthy();
    expect(amountInput("Loyer").getAttribute("aria-invalid")).toBe("true");
    expect(amountInput("Loyer").getAttribute("aria-describedby")).toBe("line-l-rent-amount-error");
    expect(amountInput("Salaire").getAttribute("aria-invalid")).toBeNull();
    expect(amountInput("Courses").getAttribute("aria-invalid")).toBeNull();
    expect(
      screen.getByText("Certains champs sont invalides. Corrigez-les puis enregistrez à nouveau. (1 erreur)"),
    ).toBeTruthy();
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("updates the margin in the preview as an amount changes, before saving", async () => {
    const user = renderForm();
    expect(screen.getByRole("heading", { name: "Aperçu" })).toBeTruthy();
    // 3 000 − 900 − 400 = 1 700 €
    expect(margin()).toBe(formatEuros(170_000));

    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "1 200");
    // 3 000 − 1 200 − 400 = 1 400 €
    expect(margin()).toBe(formatEuros(140_000));
    expect(screen.getByRole("heading", { name: "Aperçu (non enregistré)" })).toBeTruthy();

    await user.clear(amountInput("Salaire"));
    await user.type(amountInput("Salaire"), "1 500");
    // 1 500 − 1 200 − 400 = −100 € (flagged as negative)
    expect(margin()).toBe(`${formatEuros(-10_000)} (négative)`);

    // A negative amount is left out of the live totals (and flagged) until saved.
    await user.clear(amountInput("Courses"));
    await user.type(amountInput("Courses"), "-5");
    expect(margin()).toBe(formatEuros(30_000));
    expect(screen.getByText("1 montant invalide est ignoré dans les totaux.")).toBeTruthy();

    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });

  it("saves valid lines in cents", async () => {
    const user = renderForm();
    await user.clear(amountInput("Loyer"));
    await user.type(amountInput("Loyer"), "950,5");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(mocks.repo?.saveBudget).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveBudget).toHaveBeenCalledWith(SAVED_SETTINGS, [
      { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null },
      { id: "l-rent", category: "fixed", label: "Loyer", amount: 95_050, position: 0, startMonth: null, endMonth: null },
      { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0, startMonth: null, endMonth: null },
    ]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("saves the existing free savings in cents and links its hint and error", async () => {
    const user = renderForm();
    const input = screen.getByLabelText(/Épargne libre existante/);
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect((input as HTMLInputElement).value).toBe("0,00");
    expect(input.getAttribute("aria-describedby")).toBe("param-freeSavingsExisting-hint");
    expect(
      screen.getByText("Épargne disponible hors objectifs d’épargne et fonds d’urgence au début du plan (0 si aucune)."),
    ).toBeTruthy();

    await user.clear(input);
    await user.type(input, "-1");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
    expect(input.getAttribute("aria-describedby")).toBe("param-freeSavingsExisting-hint param-freeSavingsExisting-error");
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "1 234,56");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.repo?.saveBudget).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveBudget).toHaveBeenCalledWith({ ...SAVED_SETTINGS, freeSavingsExisting: 123_456 }, expect.any(Array));
  });

  it("does not save when the session has expired", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Session expirée : reconnectez-vous.")).toBeTruthy();
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });

  it("sets a period on a line, shows it compactly and saves it", async () => {
    const user = renderForm();
    const toggle = screen.getByRole("button", { name: "Période (Loyer)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.change(periodInput("Loyer", "Fin (incluse)"), { target: { value: "2026-06" } });
    // The rent stops before the reference month (September 2026): 3 000 − 400 = 2 600 €.
    expect(margin()).toBe(formatEuros(260_000));
    expect(screen.getByText("Certaines lignes changent au fil du temps : le plan en tient compte mois par mois.")).toBeTruthy();
    expect(screen.getByText("Total (sept. 2026) :", { exact: false })).toBeTruthy();

    await user.click(toggle);
    expect(screen.getByText("jusqu’à juin 2026")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.repo?.saveBudget).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveBudget).toHaveBeenCalledWith(SAVED_SETTINGS, [
      { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null },
      { id: "l-rent", category: "fixed", label: "Loyer", amount: 90_000, position: 0, startMonth: null, endMonth: "2026-06" },
      { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0, startMonth: null, endMonth: null },
    ]);
  });

  it("saves the yearly rates and a « non indexé » line, and states the indexed amounts (SPEC D27)", async () => {
    render(<BudgetForm settings={SETTINGS} lines={LINES} loans={[]} exceptions={[]} currentMonth="2028-03" />);
    const user = userEvent.setup({ delay: null });
    await user.clear(screen.getByLabelText(/Inflation des charges, par an/));
    await user.type(screen.getByLabelText(/Inflation des charges, par an/), "2");
    await user.clear(screen.getByLabelText(/Évolution des revenus, par an/));
    await user.type(screen.getByLabelText(/Évolution des revenus, par an/), "1,5");
    await user.click(screen.getByRole("button", { name: "Période (Courses)" }));
    await user.click(within(screen.getByRole("group", { name: "Période de Courses" })).getByRole("checkbox", { name: /non indexé/ }));

    // March 2028 is two Januaries after the January 2026 start: 3 000 × 1,015² and 900 × 1,02² + 400.
    const note = screen.getByText(/Les montants saisis sont ceux de 2026/);
    expect(note.textContent).toContain(`revenus ${formatEuros(309_068)}`);
    expect(note.textContent).toContain(`charges ${formatEuros(133_636)}`);

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(mocks.repo?.saveBudget).toHaveBeenCalledTimes(1));
    expect(mocks.repo?.saveBudget).toHaveBeenCalledWith({ ...SAVED_SETTINGS, expenseInflationRate: 0.02, incomeGrowthRate: 0.015 }, [
      { id: "l-income", category: "income", label: "Salaire", amount: 300_000, position: 0, startMonth: null, endMonth: null },
      { id: "l-rent", category: "fixed", label: "Loyer", amount: 90_000, position: 0, startMonth: null, endMonth: null },
      { id: "l-food", category: "variable", label: "Courses", amount: 40_000, position: 0, startMonth: null, endMonth: null, indexed: false },
    ]);
  });

  it("reports an out-of-range yearly rate on its field", async () => {
    const user = renderForm();
    await user.clear(screen.getByLabelText(/Évolution des revenus, par an/));
    await user.type(screen.getByLabelText(/Évolution des revenus, par an/), "-150");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Le taux doit être compris entre −100 % et 100 %")).toBeTruthy();
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });

  it("flags a line whose period is outside the plan", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Période (Courses)" }));
    // The plan starts in January 2026.
    fireEvent.change(periodInput("Courses", "Fin (incluse)"), { target: { value: "2025-12" } });
    expect(screen.getByText("hors de la période du plan : sans effet")).toBeTruthy();
  });

  it("#99 — warns live when two same-name lines overlap, and not once their periods follow each other", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Ajouter une charge" }));
    await user.type(screen.getByLabelText("Libellé (Charge 2)"), "loyer");
    const warnings = () => screen.queryAllByText(/lignes « (L|l)oyer » actives/);
    // The new line is still at 0 €: it weighs nothing yet, no warning (#121).
    expect(warnings()).toEqual([]);
    await user.type(amountInput("loyer"), "950");
    expect(warnings().map((w) => w.textContent)).toEqual([
      "Attention : 2 lignes « Loyer » actives chaque mois",
      "Attention : 2 lignes « loyer » actives chaque mois",
    ]);

    await user.click(screen.getByRole("button", { name: "Période (Loyer)" }));
    fireEvent.change(periodInput("Loyer", "Fin (incluse)"), { target: { value: "2027-06" } });
    expect(warnings().map((w) => w.textContent)).toEqual([
      "Attention : 2 lignes « Loyer » actives jusqu’à juin 2027",
      "Attention : 2 lignes « loyer » actives jusqu’à juin 2027",
    ]);
    await user.click(screen.getByRole("button", { name: "Période (loyer)" }));
    fireEvent.change(periodInput("loyer", "Début (inclus)"), { target: { value: "2027-07" } });
    expect(warnings()).toEqual([]);
  });

  it("#121 — a 0 € line with the same name (e.g. a hidden template line) raises no warning", async () => {
    render(
      <BudgetForm
        settings={SETTINGS}
        lines={[...LINES, { id: "l-subs", category: "fixed", label: "Abonnements", amount: 0, position: 1, startMonth: null, endMonth: null }]}
        loans={[]}
        exceptions={[]}
        currentMonth="2026-09"
      />,
    );
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Ajouter une charge" }));
    const labels = screen.getAllByLabelText(/^Libellé \(Charge \d+\)$/);
    await user.type(labels[labels.length - 1]!, "abonnements");
    await user.type(amountInput("abonnements"), "30");
    expect(screen.queryByText(/lignes « (A|a)bonnements » actives/)).toBeNull();
  });

  it("#123 — before the first save, exceptions follow « Début du plan »: earlier months flagged, the strip starts there", () => {
    render(
      <BudgetForm
        settings={null}
        lines={[]}
        loans={[]}
        exceptions={[{ id: "e-aug", month: "2026-08", kind: "expense", label: "Avant le plan", amount: 10_000 }]}
        currentMonth="2026-10"
      />,
    );
    const saved = screen.getByRole("list", { name: "Exceptions enregistrées" });
    expect(saved.textContent).toContain("(hors de la période du plan : sans effet)");
    const strip = screen.getByRole("list", { name: "Choisir un mois pour l’exception" });
    expect(strip.querySelector("button")?.getAttribute("aria-label")).toMatch(/^octobre 2026/);
  });

  it("shows an end before the start on the line and does not save", async () => {
    const user = renderForm();
    await user.click(screen.getByRole("button", { name: "Période (Loyer)" }));
    fireEvent.change(periodInput("Loyer", "Début (inclus)"), { target: { value: "2027-07" } });
    fireEvent.change(periodInput("Loyer", "Fin (incluse)"), { target: { value: "2027-06" } });
    // Collapsing does not hide the error once it is reported.
    await user.click(screen.getByRole("button", { name: "Période (Loyer)" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("La fin doit être après le début")).toBeTruthy();
    const end = periodInput("Loyer", "Fin (incluse)");
    expect(end.getAttribute("aria-invalid")).toBe("true");
    expect(end.getAttribute("aria-describedby")).toBe("line-l-rent-end-error");
    expect(screen.getByRole("button", { name: "Période (Loyer)" }).getAttribute("aria-expanded")).toBe("true");
    expect(mocks.repo?.saveBudget).not.toHaveBeenCalled();
  });
});
