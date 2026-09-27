/**
 * The computed plan as CSV (SPEC §10, issue #7): one header row and one row per month.
 * UTF-8 with a BOM and CRLF line ends, so Excel and LibreOffice read the accents correctly.
 */
import type { Cents, PlanMonth, PlanResult } from "@/lib/engine";
import { centsToDecimal, isoDate } from "./backup";

/** "fr": `;` separator and decimal comma (French Excel); "intl": `,` and decimal dot. */
export type CsvFormat = "fr" | "intl";

const BOM = "﻿";

const COLUMNS: { label: string; value: (m: PlanMonth) => Cents }[] = [
  { label: "Revenus", value: (m) => m.income },
  { label: "dont revenus exceptionnels", value: (m) => m.extraIncome },
  { label: "Dépenses", value: (m) => m.expenses },
  { label: "dont dépenses exceptionnelles", value: (m) => m.extraExpenses },
  { label: "Mensualités", value: (m) => m.loanPayments },
  { label: "Disponible", value: (m) => m.available },
  { label: "Versé déménagement", value: (m) => m.toMoving },
  { label: "Cumul déménagement", value: (m) => m.movingCumulative },
  { label: "Versé fonds d'urgence", value: (m) => m.toEmergency },
  { label: "Cumul fonds d'urgence", value: (m) => m.emergencyCumulative },
  { label: "Reste du mois", value: (m) => m.remainder },
  { label: "Remboursement anticipé", value: (m) => m.toEarlyRepayment },
  { label: "Anticipé non utilisé", value: (m) => m.unusedEarlyRepayment },
  { label: "Versé épargne libre", value: (m) => m.toFreeSavings },
  { label: "Cumul épargne libre", value: (m) => m.freeSavingsCumulative },
  { label: "Intérêts du mois", value: (m) => m.totalInterest },
  { label: "Restant dû", value: (m) => m.remainingDebt },
];

/**
 * A text cell: quoted when it contains the separator, a quote or a line break; a leading
 * `= + - @` (or tab / CR) gets a `'` so a spreadsheet never runs it as a formula.
 */
export function csvText(value: string, separator: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Amount with exactly 2 decimals; decimal comma in the French format. */
export function csvAmount(cents: Cents, format: CsvFormat): string {
  const text = centsToDecimal(cents);
  return format === "fr" ? text.replace(".", ",") : text;
}

export function planToCsv(result: PlanResult, format: CsvFormat): string {
  const sep = format === "fr" ? ";" : ",";
  const header = [
    "Mois",
    "N°",
    ...COLUMNS.map((c) => c.label),
    ...result.loans.map((l) => `Restant dû ${l.displayName}`),
    "Budget négatif",
  ].map((h) => csvText(h, sep));
  const rows = result.months.map((m) => [
    m.month,
    String(m.index),
    ...COLUMNS.map((c) => csvAmount(c.value(m), format)),
    ...m.loans.map((l) => csvAmount(l.endBalance, format)),
    m.negativeBudget ? "oui" : "non",
  ]);
  return BOM + [header, ...rows].map((cells) => cells.join(sep)).join("\r\n") + "\r\n";
}

/** "finance-plan-2026-09-28.csv" (local date). */
export function planCsvFileName(now: Date = new Date()): string {
  return `finance-plan-${isoDate(now)}.csv`;
}
