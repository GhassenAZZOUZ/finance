/**
 * Reads the spreadsheet template (`docs/plan_financier.template.xlsx`, SPEC §3 and §11) into
 * budget settings, budget lines and loans, validated with the same rules as the forms. Errors
 * name the sheet and cell. Rows are found by their labels, so inserted rows are tolerated.
 */
import { type BudgetForm, type Errors, type LoanForm, validateBudget, validateLoan } from "@/lib/domain/validation";
import { type BudgetCategory, type BudgetLineDraft, type BudgetSettings, type LoanDraft, MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import { type CellValue, type Sheet, XlsxError, openWorkbook } from "./xlsx";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const BUDGET_SHEET = "Budget";
export const LOANS_SHEET = "Crédits";

export interface CellError {
  sheet: string;
  /** "B28"; the whole sheet when absent. */
  cell?: string;
  message: string;
}

export interface TemplateData {
  /** The template has no free-savings starting amount: the import keeps the current one. */
  settings: Omit<BudgetSettings, "freeSavingsExisting">;
  lines: BudgetLineDraft[];
  loans: LoanDraft[];
}

export type TemplateResult =
  | { ok: true; data: TemplateData }
  | { ok: false; kind: "file"; message: string }
  | { ok: false; kind: "cells"; errors: CellError[] };

const WRONG_FILE =
  "Ce fichier n’est pas le modèle attendu. Importez le classeur « plan_financier » au format .xlsx (onglets « Budget » et « Crédits »).";

/** Lower case, no accents, single spaces: labels are compared loosely. */
function norm(value: CellValue | undefined): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

function lastRow(sheet: Sheet): number {
  let max = 0;
  for (const ref of sheet.keys()) max = Math.max(max, Number(/\d+$/.exec(ref)?.[0] ?? 0));
  return max;
}

/** First row (≤ 200) whose column A starts with one of `prefixes`. */
function findRow(sheet: Sheet, prefixes: string[], from = 1): number | null {
  const end = Math.min(lastRow(sheet), 200);
  for (let r = from; r <= end; r++) {
    const label = norm(sheet.get(`A${r}`));
    if (prefixes.some((p) => label.startsWith(p))) return r;
  }
  return null;
}

/** A number without binary noise (7369.349999999999 → "7369.35"), as the forms would read it. */
function numberText(n: number): string {
  return String(Number(n.toPrecision(12)));
}

function amountText(v: CellValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "number") return numberText(v);
  return String(v);
}

/** Rates are stored as fractions (0.049 = 4.9 %); text keeps its own "%". */
function percentText(v: CellValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "number") return numberText(v * 100);
  const text = String(v).trim();
  if (text.includes("%")) return text;
  const n = Number(text.replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) && text !== "" ? numberText(n * 100) : text;
}

/** Excel date serial (1900 system) or text ("2027-01", "2027-01-15", "15/01/2027", "01/2027") → "YYYY-MM". */
export function monthText(v: CellValue | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "number") {
    if (v < 1 || v > 2958465) return String(v);
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const text = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(text);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}`;
  m = /^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) return `${m[2]}-${m[1]!.padStart(2, "0")}`;
  return text;
}

const PARAMS: { field: keyof Omit<BudgetForm, "lines" | "freeSavingsExisting">; label: string; kind: "amount" | "percent" | "month" }[] = [
  { field: "startMonth", label: "date de debut du plan", kind: "month" },
  { field: "movingGoal", label: "objectif epargne demenagement", kind: "amount" },
  { field: "movingDeadlineMonth", label: "date limite demenagement", kind: "month" },
  { field: "movingAlreadySaved", label: "deja epargne pour le demenagement", kind: "amount" },
  { field: "emergencyTarget", label: "fonds d'urgence cible", kind: "amount" },
  { field: "emergencyExisting", label: "epargne de precaution deja disponible", kind: "amount" },
  { field: "riskFreeRate", label: "taux seuil", kind: "percent" },
  { field: "earlyRepaymentPct", label: "% du reste affecte", kind: "percent" },
];

const SECTIONS: { category: BudgetCategory; header: string }[] = [
  { category: "income", header: "revenus" },
  { category: "fixed", header: "charges fixes" },
  { category: "variable", header: "depenses variables" },
];

function readBudget(sheet: Sheet): { form: BudgetForm; cells: Record<string, string> } | null {
  const cells: Record<string, string> = {};
  const lines: BudgetForm["lines"] = [];
  for (const { category, header } of SECTIONS) {
    const start = findRow(sheet, [header]);
    if (start === null) return null;
    const total = findRow(sheet, ["total"], start + 1);
    if (total === null) return null;
    for (let r = start + 1; r < total; r++) {
      const label = sheet.get(`A${r}`);
      const amount = sheet.get(`B${r}`);
      if (label === undefined && amount === undefined) continue;
      const i = lines.length;
      cells[`lines.${i}.label`] = `A${r}`;
      cells[`lines.${i}.amount`] = `B${r}`;
      cells[`lines.${i}.category`] = `A${r}`;
      // A blank amount counts as 0, as in the spreadsheet's totals.
      lines.push({ category, label: label === undefined ? "" : String(label), amount: amount === undefined ? "0" : amountText(amount) });
    }
  }
  const form = { lines } as BudgetForm;
  const params = findRow(sheet, ["parametres"]);
  if (params === null) return null;
  for (const p of PARAMS) {
    const r = findRow(sheet, [p.label], params + 1);
    if (r === null) return null;
    const v = sheet.get(`B${r}`);
    form[p.field] = p.kind === "month" ? monthText(v) : p.kind === "percent" ? percentText(v) : amountText(v);
    cells[p.field] = `B${r}`;
  }
  return { form, cells };
}

const LOAN_COLUMNS: Record<keyof LoanForm | "form", string> = {
  form: "A",
  name: "A",
  type: "B",
  principal: "C",
  apr: "D",
  monthlyPayment: "E",
  contractEndMonth: "A",
  principalPaidThroughMonth: "A",
  penaltyPct: "A",
  penaltyCapMonths: "A",
  kind: "A",
  creditLimit: "A",
};

function readLoans(sheet: Sheet): { row: number; form: LoanForm }[] | null {
  let header: number | null = null;
  for (let r = 1; r <= 20 && header === null; r++) if (norm(sheet.get(`C${r}`)).startsWith("capital restant du")) header = r;
  if (header === null) return null;
  const rows: { row: number; form: LoanForm }[] = [];
  const end = Math.min(lastRow(sheet), header + 100);
  for (let r = header + 1; r <= end; r++) {
    if (norm(sheet.get(`A${r}`)) === "total") break;
    const [name, type, principal, apr, payment] = ["A", "B", "C", "D", "E"].map((col) => sheet.get(`${col}${r}`));
    if ([name, type, principal, apr, payment].every((v) => v === undefined)) continue;
    rows.push({
      row: r,
      form: {
        name: name === undefined ? "" : String(name),
        type: type === undefined ? "" : String(type),
        principal: amountText(principal),
        apr: percentText(apr),
        monthlyPayment: amountText(payment),
        // The spreadsheet's principal is the balance at the plan start (SPEC D5c: empty month).
        principalPaidThroughMonth: "",
        contractEndMonth: "",
      },
    });
  }
  return rows;
}

function toCellErrors(sheet: string, errors: Errors, cellOf: (field: string) => string | undefined): CellError[] {
  return Object.entries(errors).map(([field, message]) => ({ sheet, cell: cellOf(field), message }));
}

/** Parses the template's two input sheets. */
export function parseTemplate(budget: Sheet, loans: Sheet): TemplateResult {
  const b = readBudget(budget);
  const l = readLoans(loans);
  if (!b || !l) return { ok: false, kind: "file", message: WRONG_FILE };

  const errors: CellError[] = [];
  const validBudget = validateBudget(b.form);
  if (!validBudget.ok) errors.push(...toCellErrors(BUDGET_SHEET, validBudget.errors, (f) => b.cells[f]));

  const loanDrafts: LoanDraft[] = [];
  l.forEach(({ row, form }, i) => {
    const valid = validateLoan(form, i);
    if (valid.ok) loanDrafts.push(valid.value);
    else {
      const messages = { ...valid.errors };
      if (messages.form) messages.form = `${MAX_ACTIVE_LOANS} crédits maximum : ligne en trop`;
      errors.push(...toCellErrors(LOANS_SHEET, messages, (f) => `${LOAN_COLUMNS[f as keyof typeof LOAN_COLUMNS] ?? "A"}${row}`));
    }
  });

  if (errors.length > 0 || !validBudget.ok) return { ok: false, kind: "cells", errors };
  const settings: TemplateData["settings"] = { ...validBudget.value.settings };
  delete (settings as Partial<BudgetSettings>).freeSavingsExisting;
  return { ok: true, data: { settings, lines: validBudget.value.lines, loans: loanDrafts } };
}

/** Checks the file, opens it and parses the template. Never throws. */
export async function readTemplateFile(file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }): Promise<TemplateResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, kind: "file", message: "Fichier trop volumineux (5 Mo maximum)." };
  }
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, kind: "file", message: WRONG_FILE };
  try {
    const book = await openWorkbook(new Uint8Array(await file.arrayBuffer()));
    const [budget, loans] = await Promise.all([book.sheet(BUDGET_SHEET), book.sheet(LOANS_SHEET)]);
    if (!budget || !loans) return { ok: false, kind: "file", message: WRONG_FILE };
    return parseTemplate(budget, loans);
  } catch (error) {
    if (error instanceof XlsxError || error instanceof RangeError || error instanceof TypeError) {
      return { ok: false, kind: "file", message: WRONG_FILE };
    }
    return { ok: false, kind: "file", message: "Impossible de lire ce fichier." };
  }
}
