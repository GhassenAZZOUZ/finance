import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { type Cents, type YearMonth, monthIndex } from "@/lib/engine";

const euroFormat = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const euroWholeFormat = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** "1 234,56 €" (SPEC D12). */
export function formatEuros(cents: Cents): string {
  return euroFormat.format(cents / 100);
}

/** "1 235 €", for chart axes only. */
export function formatEurosWhole(cents: Cents): string {
  return euroWholeFormat.format(cents / 100);
}

/** Amount for an input field: "1234,56". */
export function amountInputValue(cents: Cents | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** 0.049 → "4,9 %". */
export function formatPercent(fraction: number, maxDigits = 2): string {
  return new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: maxDigits }).format(fraction);
}

/** 0.049 → "4,9" for an input field. */
export function percentInputValue(fraction: number): string {
  return String(Number((fraction * 100).toFixed(4))).replace(".", ",");
}

function toLocalDate(ym: YearMonth): Date {
  const index = monthIndex(ym);
  return new Date(Math.floor(index / 12), index % 12, 1);
}

/** "2027-01" → "janv. 2027". */
export function formatMonthShort(ym: YearMonth): string {
  return format(toLocalDate(ym), "MMM yyyy", { locale: fr });
}

/** "2027-01" → "janvier 2027". */
export function formatMonthLong(ym: YearMonth): string {
  return format(toLocalDate(ym), "MMMM yyyy", { locale: fr });
}

/** Current month in the user's time zone (Europe/Paris by default), as YYYY-MM. */
export function currentYearMonth(now: Date = new Date(), timeZone = "Europe/Paris"): YearMonth {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}
