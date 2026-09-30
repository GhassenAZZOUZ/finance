/**
 * Bank CSV import (issue #38, SPEC D30): read in the browser, never uploaded nor stored. Only the
 * column mapping is saved (per user); the check-in gets the income and expense totals.
 * Revolut exports are recognised from their header; other banks go through a column mapping.
 */
import { type Cents, type YearMonth, roundHalfAwayFromZero } from "@/lib/engine";

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

export type IsoDate = string;

/** How to read a bank's CSV; saved per user with the header it was made for. */
export interface CsvMapping {
  /** Header cells the mapping was made for: a file with the same header reuses it. */
  header: string[];
  separator: ";" | "," | "\t";
  /** Column indexes. Either `amount` (signed), or `debit` and/or `credit`. */
  date: number;
  label: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  decimal: "," | ".";
  /** "dmy": 25/09/2026 (also - or .); "ymd": 2026-09-25 (a time may follow). */
  dateFormat: "dmy" | "ymd";
}

export interface BankTransaction {
  /** 1-based line of the file (header = 1). */
  line: number;
  date: IsoDate;
  label: string;
  /** Signed: > 0 money in, < 0 money out. */
  amount: Cents;
}

export interface IgnoredRow {
  line: number;
  label: string;
  reason: string;
}

export interface ReadResult {
  transactions: BankTransaction[];
  ignored: IgnoredRow[];
}

/** UTF-8 (BOM removed), or Windows-1252 when the bytes are not valid UTF-8 (older French exports). */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The separator used by the header line: the most frequent of ; , and tab outside quotes. */
export function detectSeparator(text: string): CsvMapping["separator"] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const unquoted = first.replace(/"[^"]*"/g, "");
  const counts = ([";", ",", "\t"] as const).map((s) => [s, unquoted.split(s).length - 1] as const);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ";";
}

/** RFC 4180 rows: quoted cells may hold the separator, quotes ("") and line breaks. Blank lines are dropped. */
export function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === separator) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** "1 234,56", "-42.50", "+1.234,56 €", "(12,00)" → cents; null when unreadable. */
export function parseCsvAmount(raw: string | undefined, decimal: CsvMapping["decimal"]): Cents | null {
  let text = (raw ?? "").replace(/[\s  €]/g, "");
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-") || text.startsWith("−")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) text = text.slice(1);
  const thousands = decimal === "," ? "." : ",";
  text = text.split(thousands).join("");
  if (decimal === ",") text = text.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const cents = roundHalfAwayFromZero(Number(text) * 100);
  return negative ? -cents : cents;
}

/** "25/09/2026" (dmy, also - or .) or "2026-09-25 10:23:45" (ymd) → "2026-09-25"; null when unreadable. */
export function parseCsvDate(raw: string | undefined, format: CsvMapping["dateFormat"]): IsoDate | null {
  const text = (raw ?? "").trim();
  const m =
    format === "dmy" ? /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/.exec(text) : /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (!m) return null;
  const [year, month, day] = format === "dmy" ? [m[3]!, m[2]!, m[1]!] : [m[1]!, m[2]!, m[3]!];
  const y = year.length === 2 ? `20${year}` : year;
  const mm = Number(month);
  const dd = Number(day);
  if (mm < 1 || mm > 12 || dd < 1 || dd > new Date(Date.UTC(Number(y), mm, 0)).getUTCDate()) return null;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------- Revolut

const REVOLUT_COLUMNS = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State"];

export function isRevolut(header: readonly string[]): boolean {
  const cells = header.map((h) => h.trim());
  return REVOLUT_COLUMNS.every((c) => cells.includes(c));
}

const REVOLUT_STATE_REASON: Record<string, string> = {
  PENDING: "en attente",
  REVERTED: "annulée",
  DECLINED: "refusée",
  FAILED: "échouée",
};

/** A Revolut export (SPEC D30): amount = Amount − Fee, date = Completed Date, completed EUR rows only. */
export function readRevolut(rows: readonly string[][]): ReadResult {
  const header = rows[0]!.map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const [date, label, amount, fee, currency, state] = ["Completed Date", "Description", "Amount", "Fee", "Currency", "State"].map(col);
  const out: ReadResult = { transactions: [], ignored: [] };
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const text = (row[label!] ?? "").trim();
    const st = (row[state!] ?? "").trim().toUpperCase();
    if (st !== "COMPLETED") {
      out.ignored.push({ line, label: text, reason: `opération ${REVOLUT_STATE_REASON[st] ?? st.toLowerCase()}` });
      return;
    }
    const cur = (row[currency!] ?? "").trim().toUpperCase();
    if (cur !== "EUR") {
      out.ignored.push({ line, label: text, reason: `devise ${cur || "inconnue"}` });
      return;
    }
    const value = parseCsvAmount(row[amount!], ".");
    const charge = parseCsvAmount(row[fee!], ".") ?? 0;
    const day = parseCsvDate(row[date!], "ymd");
    if (value === null || day === null) {
      out.ignored.push({ line, label: text, reason: "montant ou date illisible" });
      return;
    }
    out.transactions.push({ line, date: day, label: text, amount: value - charge });
  });
  return out;
}

// ---------------------------------------------------------------------------------------- mapped banks

/** Rows read with a mapping (the first row is the header). */
export function readMapped(rows: readonly string[][], mapping: CsvMapping): ReadResult {
  const out: ReadResult = { transactions: [], ignored: [] };
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const text = (row[mapping.label] ?? "").trim();
    const day = parseCsvDate(row[mapping.date], mapping.dateFormat);
    let amount: Cents | null;
    if (mapping.amount !== null) amount = parseCsvAmount(row[mapping.amount], mapping.decimal);
    else {
      const debit = mapping.debit === null ? null : parseCsvAmount(row[mapping.debit], mapping.decimal);
      const credit = mapping.credit === null ? null : parseCsvAmount(row[mapping.credit], mapping.decimal);
      amount = debit === null && credit === null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (day === null || amount === null) {
      out.ignored.push({ line, label: text, reason: day === null ? "date illisible" : "montant illisible" });
      return;
    }
    out.transactions.push({ line, date: day, label: text, amount });
  });
  return out;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** A first mapping from the header names (French and English banks); the user checks it. */
export function guessMapping(header: readonly string[], separator: CsvMapping["separator"], sample: readonly string[][]): CsvMapping {
  const names = header.map(norm);
  // Keys in priority order: the first key found in some column wins.
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const i = names.findIndex((n) => n.includes(k));
      if (i >= 0) return i;
    }
    return null;
  };
  const date = find("date operation", "date op", "date") ?? 0;
  const label = find("libelle", "description", "label", "detail", "operation") ?? Math.min(1, header.length - 1);
  const debit = find("debit");
  const credit = find("credit");
  const amount = debit === null && credit === null ? (find("montant", "amount", "somme") ?? Math.min(2, header.length - 1)) : null;
  const firstDate = sample[0]?.[date] ?? "";
  const cells = sample.flatMap((r) => [amount, debit, credit].flatMap((c) => (c === null ? [] : [r[c] ?? ""])));
  const commaDecimal = cells.some((c) => /\d,\d{1,2}\s*€?$/.test(c.trim()));
  return {
    header: [...header],
    separator,
    date,
    label,
    amount,
    debit,
    credit,
    decimal: commaDecimal || separator === ";" ? "," : ".",
    dateFormat: /^\d{4}-/.test(firstDate.trim()) ? "ymd" : "dmy",
  };
}

export function sameHeader(mapping: Pick<CsvMapping, "header"> | null, header: readonly string[]): boolean {
  return mapping !== null && mapping.header.length === header.length && mapping.header.every((h, i) => h.trim() === header[i]!.trim());
}

/** The chosen month's transactions, and how many fall outside it. */
export function transactionsOfMonth(transactions: readonly BankTransaction[], month: YearMonth): { inMonth: BankTransaction[]; outside: number } {
  const inMonth = transactions.filter((t) => t.date.startsWith(`${month}-`));
  return { inMonth, outside: transactions.length - inMonth.length };
}

/** Where a transaction goes: a budget line id, or null for « Ignoré ». */
export type Assignment = string | null;

/**
 * Check-in totals (SPEC §8.1): income = Σ amounts on income lines; expenses = − Σ amounts on
 * fixed / variable lines (a refund lowers them). Ignored transactions count nowhere.
 */
export function totalsOf(
  transactions: readonly BankTransaction[],
  assignments: readonly Assignment[],
  categoryOf: (lineId: string) => "income" | "fixed" | "variable" | undefined,
): { income: Cents; expenses: Cents } {
  let income = 0;
  let expenses = 0;
  transactions.forEach((t, i) => {
    const lineId = assignments[i];
    const category = lineId ? categoryOf(lineId) : undefined;
    if (category === "income") income += t.amount;
    else if (category) expenses -= t.amount;
  });
  return { income, expenses };
}

/** A file the import accepts: .csv or text, ≤ 5 MB, not empty. French messages otherwise. */
export function checkCsvFile(file: { name: string; size: number; type: string }): string | null {
  if (file.size > MAX_CSV_BYTES) return "Fichier trop volumineux : 5 Mo maximum.";
  if (file.size === 0) return "Le fichier est vide.";
  const csvLike = /\.(csv|txt)$/i.test(file.name) || /^text\//.test(file.type) || file.type === "application/vnd.ms-excel";
  if (!csvLike) return "Choisissez l’export CSV de votre banque (fichier .csv), pas un PDF ni un classeur Excel.";
  return null;
}
