/** Bank CSV import in the check-in (issue #38, SPEC D30). Invented data only. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BankImport } from "@/app/(app)/suivi/bank-import";
import type { BudgetLine } from "@/lib/domain/types";
import type { CsvMapping } from "@/lib/import/bank-csv";
import type { BankRule } from "@/lib/import/bank-rules";
import { LineActualsCard } from "@/app/(app)/suivi/line-actuals-card";
import { formatEuros } from "@/lib/format";
import { type RepositoryMock, createRepositoryMock } from "./helpers";

const mocks = vi.hoisted(() => ({ repo: null as RepositoryMock | null, notify: vi.fn() }));
vi.mock("@/lib/data/client-store", () => ({ getRepository: () => mocks.repo, notifyDataChanged: mocks.notify }));

const line = (id: string, category: BudgetLine["category"], label: string): BudgetLine => ({
  id,
  category,
  label,
  amount: 10_000,
  position: 0,
  startMonth: null,
  endMonth: null,
});
const LINES = [line("salary", "income", "Salaire"), line("rent", "fixed", "Loyer"), line("food", "variable", "Courses")];

const REVOLUT = [
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
  "TOPUP,Current,2026-09-01 08:00:00,2026-09-01 08:00:02,Virement salaire,2600.00,0.00,EUR,COMPLETED,2600.00",
  "CARD_PAYMENT,Current,2026-09-02 10:00:00,2026-09-03 09:00:00,<img src=x onerror=alert(1)>,-42.50,0.00,EUR,COMPLETED,2557.50",
  "TRANSFER,Current,2026-09-04 10:00:00,2026-09-04 10:00:01,Vers Livret A,-500.00,0.00,EUR,COMPLETED,2057.50",
  "CARD_PAYMENT,Current,2026-09-05 12:00:00,,Café,-3.20,0.00,EUR,PENDING,",
  "CARD_PAYMENT,Current,2026-10-01 12:00:00,2026-10-01 12:00:01,Octobre,-9.00,0.00,EUR,COMPLETED,2048.50",
].join("\n");
const BANK_FR = ["Date opération;Libellé;Débit;Crédit", "01/09/2026;SALAIRE;;2 600,00", "15/09/2026;CARREFOUR;123,40;"].join("\n");

const csv = (text: string, name = "releve.csv") => new File([text], name, { type: "text/csv" });

function renderImport(savedMapping: CsvMapping | null = null, rules: BankRule[] = []) {
  const onApply = vi.fn();
  render(<BankImport month="2026-09" lines={LINES} savedMapping={savedMapping} rules={rules} onApply={onApply} />);
  // applyAccept: false lets a test pick a file the picker would hide (the component still checks it).
  return { user: userEvent.setup({ applyAccept: false }), onApply };
}
const upload = (user: ReturnType<typeof userEvent.setup>, file: File) =>
  user.upload(screen.getByLabelText("Importer le relevé CSV de septembre 2026"), file);
const row = (label: string) => screen.getByText(label).closest("li")!;

beforeEach(() => {
  mocks.repo = createRepositoryMock();
});
afterEach(cleanup);

describe("BankImport", () => {
  it("AC-07 / AC-01 — reads a Revolut export without mapping, the month only", async () => {
    const { user } = renderImport();
    await upload(user, csv(REVOLUT));
    expect(await screen.findByRole("heading", { name: "3 opérations en septembre 2026" })).toBeTruthy();
    expect(screen.getByText("1 hors du mois · 1 ignorée")).toBeTruthy();
    expect(screen.getByText(/Ligne 5 \(Café\) : opération en attente/)).toBeTruthy();
    // Labels are shown as text, never as HTML.
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("AC-03 / AC-04 — assigns, updates the totals live and pre-fills the check-in rows (#72)", async () => {
    const { user, onApply } = renderImport();
    await upload(user, csv(REVOLUT));
    await screen.findByRole("heading", { name: "3 opérations en septembre 2026" });
    await user.selectOptions(within(row("Vers Livret A")).getByRole("combobox"), "");
    expect(screen.getByRole("status").textContent).toBe(`Revenus ${formatEuros(260_000)} · Dépenses ${formatEuros(4_250)}`);
    await user.click(screen.getByRole("button", { name: "Reporter dans le suivi" }));
    expect(onApply).toHaveBeenCalledWith([
      { budgetLineId: "salary", actual: 260_000 },
      { budgetLineId: "food", actual: 4_250 },
    ]);
    // Revolut needs no mapping: nothing is saved.
    expect(mocks.repo!.setBankCsvMapping).not.toHaveBeenCalled();
  });

  it("AC-02 — maps another bank's columns once and saves only the mapping", async () => {
    const { user, onApply } = renderImport();
    await upload(user, csv(BANK_FR));
    expect(await screen.findByText("Colonnes de votre relevé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByRole("heading", { name: "2 opérations en septembre 2026" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reporter dans le suivi" }));
    expect(onApply).toHaveBeenCalledWith([
      { budgetLineId: "salary", actual: 260_000 },
      { budgetLineId: "food", actual: 12_340 },
    ]);
    await waitFor(() => expect(mocks.repo!.setBankCsvMapping).toHaveBeenCalledOnce());
    const saved = mocks.repo!.setBankCsvMapping.mock.calls[0]![0]!;
    expect(saved).toMatchObject({ header: ["Date opération", "Libellé", "Débit", "Crédit"], debit: 2, credit: 3, decimal: "," });
    // AC-05: the mapping holds no transaction.
    expect(JSON.stringify(saved)).not.toContain("CARREFOUR");
  });

  it("reuses a saved mapping for the same header", async () => {
    const saved: CsvMapping = {
      header: ["Date opération", "Libellé", "Débit", "Crédit"],
      separator: ";",
      date: 0,
      label: 1,
      amount: null,
      debit: 2,
      credit: 3,
      decimal: ",",
      dateFormat: "dmy",
    };
    const { user } = renderImport(saved);
    await upload(user, csv(BANK_FR));
    expect(await screen.findByRole("heading", { name: "2 opérations en septembre 2026" })).toBeTruthy();
    expect(screen.queryByText("Colonnes de votre relevé")).toBeNull();
  });

  it("AC-06 — rejects a PDF and an empty file in French", async () => {
    const { user } = renderImport();
    await user.upload(screen.getByLabelText("Importer le relevé CSV de septembre 2026"), new File(["%PDF"], "releve.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toContain("pas un PDF");
    await upload(user, csv("Date;Libellé;Montant\n"));
    expect((await screen.findByRole("alert")).textContent).toContain("Aucune opération dans ce fichier");
  });
});

describe("rules and per-line totals (#63, SPEC D31)", () => {
  it("AC-01 / AC-03 — proposes from a rule, then hands the totals to the check-in and stores the learnt rules", async () => {
    const { user, onApply } = renderImport(null, [{ id: "r1", keyword: "VERS LIVRET", budgetLineId: null }]);
    await upload(user, csv(REVOLUT));
    await screen.findByRole("heading", { name: "3 opérations en septembre 2026" });
    expect(within(row("Vers Livret A")).getByText("proposé")).toBeTruthy();
    expect((within(row("Vers Livret A")).getByRole("combobox") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Reporter dans le suivi" }));
    // The totals are saved with the check-in (#72), only the rules are stored now.
    expect(onApply).toHaveBeenCalledWith([
      { budgetLineId: "salary", actual: 260_000 },
      { budgetLineId: "food", actual: 4_250 },
    ]);
    await waitFor(() => expect(mocks.repo!.saveBankRules).toHaveBeenCalledOnce());
    const [rules] = mocks.repo!.saveBankRules.mock.calls[0]!;
    expect(rules).toContainEqual({ keyword: "SALAIRE", budgetLineId: "salary" });
    expect(rules).toContainEqual({ keyword: "LIVRET", budgetLineId: null });
    expect(mocks.notify).toHaveBeenCalled();
  });

  it("AC-04 — lists the rules and deletes one", async () => {
    const { user } = renderImport(null, [{ id: "r1", keyword: "CARREFOUR", budgetLineId: "food" }]);
    await user.click(screen.getByText("Règles apprises (1)"));
    expect(screen.getByText("« CARREFOUR » → Courses")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Supprimer la règle « CARREFOUR »" }));
    expect(mocks.repo!.deleteBankRule).toHaveBeenCalledWith("r1");
  });

  it("AC-02 — shows « Réel vs budget » per line of a check-in (#72), flagging the lines off budget in words", () => {
    const saved = (label: string, direction: "income" | "expense", planned: number, actual: number) => ({
      kind: "line" as const,
      direction,
      category: direction === "income" ? ("income" as const) : ("variable" as const),
      budgetLineId: label,
      exceptionId: null,
      label,
      planned,
      actual,
    });
    render(
      <LineActualsCard
        actuals={[
          {
            id: "a",
            month: "2026-09",
            income: 10_000,
            expenses: 25_000,
            emergencySavings: 0,
            freeSavings: 0,
            loanBalances: [],
            goalBalances: [],
            frozen: null,
            lines: [saved("Salaire", "income", 10_000, 10_000), saved("Courses", "expense", 10_000, 15_000), saved("Loyer", "expense", 10_000, 0)],
          },
        ]}
      />,
    );
    const food = screen.getByText("Courses").closest("tr")!;
    expect(food.textContent).toContain("dépassement");
    expect(food.textContent).toContain(formatEuros(5_000));
    expect(screen.getByText("Salaire").closest("tr")!.textContent).not.toContain("en dessous");
    expect(screen.getByText("Loyer").closest("tr")!.textContent).toContain(formatEuros(-10_000));
  });
});
