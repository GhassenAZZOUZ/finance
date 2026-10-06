/**
 * Several bank statements per month (issue #115, SPEC D30): each statement imported into a named
 * account adds its totals per budget line to the check-in rows and can be removed later, its exact
 * amounts subtracted. Pure functions; still no transaction stored, only a fingerprint and totals.
 */
import type { BankAccount, BankStatement } from "@/lib/domain/types";
import { type Cents, roundHalfAwayFromZero } from "@/lib/engine";
import { amountInputValue } from "@/lib/format";
import type { BankTransaction, CsvMapping } from "./bank-csv";
import { sameHeader } from "./bank-csv";
import { normalizeLabel } from "./bank-rules";

/** Transfer legs between two accounts are paired when their dates are at most this far apart. */
export const TRANSFER_WINDOW_DAYS = 3;

/** Statements kept per check-in (a guard for the stored summaries, far above real use). */
export const MAX_STATEMENTS_PER_MONTH = 20;

/** 32-bit FNV-1a of a string, from a given seed. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Fingerprint of a statement's transactions for the month (16 hex digits): the same transactions give
 * the same fingerprint whatever their order and the file's name, so a re-downloaded or renamed file
 * is recognised. Labels are normalised (case, accents, spaces).
 */
export function statementFingerprint(transactions: readonly Pick<BankTransaction, "date" | "label" | "amount">[]): string {
  const text = transactions
    .map((t) => `${t.date}|${normalizeLabel(t.label)}|${t.amount}`)
    .sort()
    .join("\n");
  return [fnv1a(text, 0x811c9dc5), fnv1a(text, 0x01234567)].map((h) => h.toString(16).padStart(8, "0")).join("");
}

/** Money in and out of the month's transactions (positive amounts). */
export function statementTotals(transactions: readonly Pick<BankTransaction, "amount">[]): { totalIn: Cents; totalOut: Cents } {
  let totalIn = 0;
  let totalOut = 0;
  for (const t of transactions) {
    if (t.amount > 0) totalIn += t.amount;
    else totalOut -= t.amount;
  }
  return { totalIn, totalOut };
}

/** Accounts are told apart by id, or by their name while still being created. */
export type AccountRef = { id: string } | { name: string };

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("fr") === b.trim().toLocaleLowerCase("fr");

export function sameAccount(a: AccountRef, b: AccountRef): boolean {
  if ("id" in a && "id" in b) return a.id === b.id;
  if ("name" in a && "name" in b) return sameName(a.name, b.name);
  return false;
}

/** The statement's account as a reference: a saved statement whose account was deleted has only a name. */
export function accountOf(statement: Pick<BankStatement, "accountId" | "accountName">): AccountRef {
  return statement.accountId ? { id: statement.accountId } : { name: statement.accountName };
}

/** True when the same transactions were already imported into the same account (owner decision, AC-05). */
export function isDuplicate(
  existing: readonly { account: AccountRef; fingerprint: string }[],
  account: AccountRef,
  fingerprint: string,
): boolean {
  return existing.some((s) => s.fingerprint === fingerprint && sameAccount(s.account, account));
}

/** The column mapping to read a file of this account: its own when the header matches, else none. */
export function mappingFor(account: Pick<BankAccount, "mapping"> | null, header: readonly string[], fallback: CsvMapping | null = null): CsvMapping | null {
  if (account?.mapping && sameHeader(account.mapping, header)) return account.mapping;
  // Before #115 one mapping was saved per user: it still serves a new account with the same header.
  if (!account?.mapping && fallback && sameHeader(fallback, header)) return fallback;
  return null;
}

/** Whole days between two ISO dates (YYYY-MM-DD), always ≥ 0. */
export function daysApart(a: string, b: string): number {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round(Math.abs(day(a) - day(b)) / 86_400_000);
}

export interface Leg {
  /** Index of the statement in the batch, and of the transaction in it. */
  statement: number;
  index: number;
}

export interface TransferPair {
  /** The money out (debit) and the money in (credit). */
  out: Leg;
  in: Leg;
  amount: Cents;
}

export const legKey = (leg: Leg) => `${leg.statement}:${leg.index}`;
export const pairKey = (pair: TransferPair) => `${legKey(pair.out)}>${legKey(pair.in)}`;

/**
 * Transfers between the user's accounts (owner decision, AC-04): a debit in one statement and a credit
 * of the same amount to the cent in a statement of **another** account, at most 3 days apart. Each leg
 * is used once; the closest dates are paired first. Proposals only: the user confirms them.
 */
export function pairTransfers(statements: readonly { account: AccountRef; transactions: readonly BankTransaction[] }[]): TransferPair[] {
  const candidates: (TransferPair & { days: number })[] = [];
  statements.forEach((a, i) => {
    a.transactions.forEach((debit, di) => {
      if (debit.amount >= 0) return;
      statements.forEach((b, j) => {
        if (i === j || sameAccount(a.account, b.account)) return;
        b.transactions.forEach((credit, ci) => {
          if (credit.amount !== -debit.amount) return;
          const days = daysApart(debit.date, credit.date);
          if (days <= TRANSFER_WINDOW_DAYS) {
            candidates.push({ out: { statement: i, index: di }, in: { statement: j, index: ci }, amount: credit.amount, days });
          }
        });
      });
    });
  });
  candidates.sort((x, y) => x.days - y.days || x.out.statement - y.out.statement || x.out.index - y.out.index || x.in.index - y.in.index);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const candidate of candidates) {
    const pair: TransferPair = { out: candidate.out, in: candidate.in, amount: candidate.amount };
    if (used.has(legKey(pair.out)) || used.has(legKey(pair.in))) continue;
    used.add(legKey(pair.out));
    used.add(legKey(pair.in));
    pairs.push(pair);
  }
  return pairs;
}

const parseCents = (text: string): Cents | null => {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? roundHalfAwayFromZero(n * 100) : null;
};
const formatCents = (cents: Cents) => (cents < 0 ? `-${amountInputValue(-cents)}` : amountInputValue(cents));

/**
 * Adds (sign 1) or subtracts (sign −1) a statement's totals to the rows of its budget lines. An
 * added statement also fills the other empty budget-line rows with 0 (a line without transaction
 * was not spent on); a row typed by hand keeps its amount plus the statement's (owner decision).
 */
export function addLineTotals(
  lines: readonly { key: string; actual: string }[],
  rows: readonly { key: string; kind: string; budgetLineId: string | null }[],
  totals: readonly { budgetLineId: string; actual: Cents }[],
  sign: 1 | -1,
): { key: string; actual: string }[] {
  return lines.map((l) => {
    const row = rows.find((r) => r.key === l.key);
    if (row?.kind !== "line") return l;
    const total = totals.find((t) => t.budgetLineId === row.budgetLineId)?.actual ?? 0;
    const current = parseCents(l.actual);
    // An amount typed wrong is left for the user to fix rather than overwritten.
    if (current === null && l.actual.trim() !== "") return l;
    if (total === 0 && (sign === -1 || current !== null)) return l;
    return { ...l, actual: formatCents((current ?? 0) + sign * total) };
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCents = (v: unknown, min = -1e13): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v < 1e13;

/**
 * The statements posted with a check-in (untrusted JSON): null when malformed. Accounts and budget
 * lines must be the user's; a total for a line that no longer exists is dropped.
 */
export function parseStatements(
  raw: unknown,
  { accountIds, lineIds }: { accountIds: ReadonlySet<string>; lineIds: ReadonlySet<string> },
): BankStatement[] | null {
  if (raw === null || raw === undefined || raw === "") return [];
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length > MAX_STATEMENTS_PER_MONTH) return null;
  const out: BankStatement[] = [];
  for (const s of data) {
    if (!isRecord(s)) return null;
    const { accountId, accountName, fileName, fingerprint, transactionCount, totalIn, totalOut, lineTotals } = s;
    if (accountId !== null && (typeof accountId !== "string" || !accountIds.has(accountId))) return null;
    if (typeof accountName !== "string" || accountName.trim().length < 1 || accountName.trim().length > 60) return null;
    if (typeof fileName !== "string" || fileName.length < 1 || fileName.length > 255) return null;
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{16,64}$/.test(fingerprint)) return null;
    if (!isCents(transactionCount, 0) || transactionCount > 100_000) return null;
    if (!isCents(totalIn, 0) || !isCents(totalOut, 0)) return null;
    if (!Array.isArray(lineTotals) || lineTotals.length > 200) return null;
    const totals: BankStatement["lineTotals"] = [];
    for (const t of lineTotals) {
      if (!isRecord(t) || typeof t.budgetLineId !== "string" || !isCents(t.actual)) return null;
      if (lineIds.has(t.budgetLineId)) totals.push({ budgetLineId: t.budgetLineId, actual: t.actual });
    }
    out.push({ accountId, accountName: accountName.trim(), fileName, fingerprint, transactionCount, totalIn, totalOut, lineTotals: totals });
  }
  return out;
}
