/** Bank CSV import in the check-in (issues #38, #63, #115; SPEC D30/D31). Invented data only. */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BankImport } from "@/app/(app)/suivi/bank-import";
import type { BankAccount, BankStatement, BudgetLine } from "@/lib/domain/types";
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

const BNP_MAPPING: CsvMapping = {
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
const REV: BankAccount = { id: "rev", name: "Revolut", mapping: null };
const BNP: BankAccount = { id: "bnp", name: "Compte courant BNP", mapping: BNP_MAPPING };

function renderImport({
  accounts = [],
  legacyMapping = null,
  rules = [],
  statements = [],
}: { accounts?: BankAccount[]; legacyMapping?: CsvMapping | null; rules?: BankRule[]; statements?: BankStatement[] } = {}) {
  const onApply = vi.fn<(added: BankStatement[]) => void>();
  const onRemove = vi.fn<(index: number) => void>();
  render(
    <BankImport
      month="2026-09"
      lines={LINES}
      accounts={accounts}
      legacyMapping={legacyMapping}
      rules={rules}
      statements={statements}
      onApply={onApply}
      onRemove={onRemove}
    />,
  );
  // applyAccept: false lets a test pick a file the picker would hide (the component still checks it).
  return { user: userEvent.setup({ applyAccept: false, delay: null }), onApply, onRemove };
}
type User = ReturnType<typeof userEvent.setup>;
const fileInput = () => screen.getByLabelText(/(Importer le relevé CSV|Ajouter un autre relevé) de septembre 2026/);
const upload = (user: User, file: File) => user.upload(fileInput(), file);
const pickAccount = (user: User, name: string) => user.selectOptions(screen.getByLabelText("Compte du relevé"), name);
/** Names a new account, then picks the file. */
async function uploadNew(user: User, account: string, file: File) {
  await pickAccount(user, "Nouveau compte…");
  const name = screen.getByLabelText("Nom du nouveau compte");
  await user.clear(name);
  await user.type(name, account);
  await upload(user, file);
}
const row = (label: string) => screen.getByText(label).closest("li")!;
const report = (user: User) => user.click(screen.getByRole("button", { name: "Reporter dans le suivi" }));
async function applied(onApply: ReturnType<typeof vi.fn<(added: BankStatement[]) => void>>): Promise<BankStatement[]> {
  await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
  return onApply.mock.calls[0]![0];
}

beforeEach(() => {
  mocks.repo = createRepositoryMock();
  mocks.notify.mockClear();
});
afterEach(cleanup);

describe("BankImport", () => {
  it("reads a Revolut export without mapping, the month only (#38)", async () => {
    const { user } = renderImport();
    await uploadNew(user, "Revolut", csv(REVOLUT));
    expect(await screen.findByRole("heading", { name: "Revolut · releve.csv : 3 opérations en septembre 2026" })).toBeTruthy();
    expect(screen.getByText("1 hors du mois · 1 ignorée")).toBeTruthy();
    expect(screen.getByText(/Ligne 5 \(Café\) : opération en attente/)).toBeTruthy();
    // Labels are shown as text, never as HTML.
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("AC-07 (#115) — asks for the account's name before reading a file, and refuses a name already used", async () => {
    const first = renderImport();
    await upload(first.user, csv(REVOLUT));
    expect((await screen.findByRole("alert")).textContent).toContain("Nommez le compte");
    cleanup();

    const { user } = renderImport({ accounts: [REV] });
    await uploadNew(user, " revolut ", csv(REVOLUT));
    expect((await screen.findByRole("alert")).textContent).toContain("existe déjà");
  });

  it("assigns, updates the totals live, creates the account and adds the statement (#72, #115)", async () => {
    const { user, onApply } = renderImport();
    await uploadNew(user, "Revolut", csv(REVOLUT));
    await screen.findByRole("heading", { name: /3 opérations en septembre 2026/ });
    await user.selectOptions(within(row("Vers Livret A")).getByRole("combobox"), "");
    expect(screen.getByRole("status").textContent).toBe(`Revenus ${formatEuros(260_000)} · Dépenses ${formatEuros(4_250)}`);
    await report(user);
    const [statement] = await applied(onApply);
    // Revolut needs no mapping.
    expect(mocks.repo!.createBankAccount).toHaveBeenCalledWith("Revolut", null);
    expect(statement).toMatchObject({
      accountId: "account-Revolut",
      accountName: "Revolut",
      fileName: "releve.csv",
      transactionCount: 3,
      totalIn: 260_000,
      totalOut: 54_250,
      lineTotals: [
        { budgetLineId: "salary", actual: 260_000 },
        { budgetLineId: "food", actual: 4_250 },
      ],
    });
    expect(statement!.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // AC-06: what is kept holds no transaction.
    expect(JSON.stringify(statement)).not.toContain("Livret");
  });

  it("maps another bank's columns once and saves them to its new account (#115 AC-03)", async () => {
    const { user, onApply } = renderImport();
    await uploadNew(user, "BNP", csv(BANK_FR));
    expect(await screen.findByText("Colonnes du relevé « BNP »")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByRole("heading", { name: "BNP · releve.csv : 2 opérations en septembre 2026" })).toBeTruthy();
    await report(user);
    expect((await applied(onApply))[0]!.lineTotals).toEqual([
      { budgetLineId: "salary", actual: 260_000 },
      { budgetLineId: "food", actual: 12_340 },
    ]);
    const [name, mapping] = mocks.repo!.createBankAccount.mock.calls[0]!;
    expect(name).toBe("BNP");
    expect(mapping).toMatchObject({ header: ["Date opération", "Libellé", "Débit", "Crédit"], debit: 2, credit: 3, decimal: "," });
    expect(JSON.stringify(mapping)).not.toContain("CARREFOUR");
    expect(mocks.repo!.setBankCsvMapping).not.toHaveBeenCalled();
  });

  it("AC-03 (#115) — each account reuses its own mapping, without asking", async () => {
    const { user } = renderImport({ accounts: [REV, BNP] });
    await pickAccount(user, "Revolut");
    await upload(user, csv(REVOLUT));
    await screen.findByRole("heading", { name: /^Revolut/ });
    await pickAccount(user, "Compte courant BNP");
    await upload(user, csv(BANK_FR));
    expect(await screen.findByRole("heading", { name: /^Compte courant BNP · releve\.csv : 2 opérations/ })).toBeTruthy();
    expect(screen.queryByText(/Colonnes du relevé/)).toBeNull();
  });

  it("asks again when the account's saved header differs, and offers the pre-#115 mapping to a new account", async () => {
    const first = renderImport({ accounts: [{ ...BNP, mapping: { ...BNP_MAPPING, header: ["Date", "Libellé", "Montant"] } }] });
    await upload(first.user, csv(BANK_FR));
    expect(await screen.findByText("Colonnes du relevé « Compte courant BNP »")).toBeTruthy();
    cleanup();

    const { user, onApply } = renderImport({ legacyMapping: BNP_MAPPING });
    await uploadNew(user, "Banque", csv(BANK_FR));
    expect(await screen.findByRole("heading", { name: /^Banque · releve\.csv : 2 opérations/ })).toBeTruthy();
    await report(user);
    await applied(onApply);
    expect(mocks.repo!.createBankAccount).toHaveBeenCalledWith("Banque", BNP_MAPPING);
  });

  describe("transfers between the user's accounts (AC-04, #115)", () => {
    const bnp = [
      "Date opération;Libellé;Débit;Crédit",
      "01/09/2026;SALAIRE;;2 600,00",
      "02/09/2026;VIREMENT VERS REVOLUT;500,00;",
      "15/09/2026;CARREFOUR;123,40;",
    ].join("\n");
    const revolut = [
      "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
      "TOPUP,Current,2026-09-03 08:00:00,2026-09-03 08:00:02,Top-up,500.00,0.00,EUR,COMPLETED,500.00",
      "CARD_PAYMENT,Current,2026-09-10 10:00:00,2026-09-10 10:00:01,Monoprix,-80.00,0.00,EUR,COMPLETED,420.00",
    ].join("\n");

    async function loadBoth() {
      const rendered = renderImport({ accounts: [BNP, REV] });
      await upload(rendered.user, csv(bnp, "bnp.csv"));
      await pickAccount(rendered.user, "Revolut");
      await upload(rendered.user, csv(revolut, "revolut.csv"));
      expect(await screen.findByText("Virements entre vos comptes ?")).toBeTruthy();
      return rendered;
    }

    it("proposes the pair; once confirmed neither leg counts", async () => {
      const { user, onApply } = await loadBoth();
      const proposal = screen.getByText(/de « Compte courant BNP » \(02\/09\/2026\) vers « Revolut » \(03\/09\/2026\)/);
      expect(proposal.textContent).toContain(formatEuros(50_000));
      await user.click(screen.getByRole("button", { name: /^Confirmer le virement/ }));
      expect(screen.getAllByText("Virement entre vos comptes")).toHaveLength(2);
      await report(user);
      const [fromBnp, fromRevolut] = await applied(onApply);
      expect(fromBnp!.lineTotals).toEqual([
        { budgetLineId: "salary", actual: 260_000 },
        { budgetLineId: "food", actual: 12_340 },
      ]);
      expect(fromRevolut!.lineTotals).toEqual([{ budgetLineId: "food", actual: 8_000 }]);
      // The confirmed legs teach « Ignoré » rules.
      const [rules] = mocks.repo!.saveBankRules.mock.calls[0]!;
      expect(rules).toContainEqual({ keyword: "REVOLUT", budgetLineId: null });
    });

    it("counts both legs normally when the user says it is not a transfer", async () => {
      const { user, onApply } = await loadBoth();
      await user.click(screen.getByRole("button", { name: /^Ce n’est pas un virement/ }));
      expect(screen.getByText(/compté normalement/)).toBeTruthy();
      await report(user);
      const [fromBnp, fromRevolut] = await applied(onApply);
      // The first guesses stand: the debit on « Courses », the top-up on « Salaire ».
      expect(fromBnp!.lineTotals).toContainEqual({ budgetLineId: "food", actual: 62_340 });
      expect(fromRevolut!.lineTotals).toContainEqual({ budgetLineId: "salary", actual: 50_000 });
    });
  });

  it("AC-05 (#115) — the same statement in the same account is refused, even renamed or already reported", async () => {
    const { user, onApply } = renderImport({ accounts: [REV] });
    await upload(user, csv(REVOLUT));
    await screen.findByRole("heading", { name: /^Revolut/ });
    await upload(user, csv(REVOLUT, "copie.csv"));
    expect((await screen.findByRole("alert")).textContent).toContain("déjà importé dans « Revolut »");
    await report(user);
    const [statement] = await applied(onApply);
    cleanup();

    const again = renderImport({ accounts: [REV], statements: [statement!] });
    await upload(again.user, csv(REVOLUT, "septembre.csv"));
    expect((await screen.findByRole("alert")).textContent).toContain("déjà importé");
    expect(screen.queryByRole("button", { name: "Reporter dans le suivi" })).toBeNull();
  });

  it("AC-02 (#115) — lists the month's statements with their totals; « Retirer » removes one", async () => {
    const statement: BankStatement = {
      accountId: "rev",
      accountName: "Revolut",
      fileName: "septembre.csv",
      fingerprint: "0123456789abcdef",
      transactionCount: 12,
      totalIn: 260_000,
      totalOut: 54_250,
      lineTotals: [{ budgetLineId: "food", actual: 4_250 }],
    };
    const { user, onRemove } = renderImport({ statements: [statement, { ...statement, accountId: null, accountName: "BNP", fileName: "bnp.csv" }] });
    const list = screen.getByRole("region", { name: "Relevés importés pour septembre 2026" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain(`12 opérations · entrées ${formatEuros(260_000)} · sorties ${formatEuros(54_250)}`);
    await user.click(within(list).getByRole("button", { name: "Retirer le relevé « bnp.csv » (BNP)" }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("AC-07 (#115) — renames and deletes an account in the import section", async () => {
    const { user } = renderImport({ accounts: [REV] });
    await user.click(screen.getByText("Vos comptes (1)"));
    await user.click(screen.getByRole("button", { name: "Renommer « Revolut »" }));
    const name = screen.getByLabelText("Nouveau nom de « Revolut »");
    await user.clear(name);
    await user.type(name, "Revolut perso");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mocks.repo!.updateBankAccount).toHaveBeenCalledWith("rev", { name: "Revolut perso" });

    await user.click(screen.getByRole("button", { name: "Supprimer « Revolut »" }));
    expect(screen.getByText(/Les montants déjà reportés sont conservés/)).toBeTruthy();
    expect(mocks.repo!.deleteBankAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Supprimer le compte" }));
    expect(mocks.repo!.deleteBankAccount).toHaveBeenCalledWith("rev");
  });

  it("rejects a PDF and an empty file in French", async () => {
    const { user } = renderImport({ accounts: [REV] });
    await user.upload(fileInput(), new File(["%PDF"], "releve.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toContain("pas un PDF");
    await upload(user, csv("Date;Libellé;Montant\n"));
    expect((await screen.findByRole("alert")).textContent).toContain("Aucune opération dans ce fichier");
  });
});

describe("rules and per-line totals (#63, SPEC D31)", () => {
  it("AC-01 / AC-03 — proposes from a rule, then hands the totals to the check-in and stores the learnt rules", async () => {
    const { user, onApply } = renderImport({ accounts: [REV], rules: [{ id: "r1", keyword: "VERS LIVRET", budgetLineId: null }] });
    await upload(user, csv(REVOLUT));
    await screen.findByRole("heading", { name: /3 opérations en septembre 2026/ });
    expect(within(row("Vers Livret A")).getByText("proposé")).toBeTruthy();
    expect((within(row("Vers Livret A")).getByRole("combobox") as HTMLSelectElement).value).toBe("");
    await report(user);
    // The totals are saved with the check-in (#72); only the rules are stored now.
    expect((await applied(onApply))[0]!.lineTotals).toEqual([
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
    const { user } = renderImport({ rules: [{ id: "r1", keyword: "CARREFOUR", budgetLineId: "food" }] });
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
