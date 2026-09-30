/** Bank CSV import (issue #38, SPEC D30): parsing, Revolut preset, mapping, month filter, totals. Invented data only. */
import { describe, expect, it } from "vitest";
import {
  type CsvMapping,
  checkCsvFile,
  decodeCsv,
  detectSeparator,
  guessMapping,
  isRevolut,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
  readMapped,
  readRevolut,
  sameHeader,
  totalsOf,
  transactionsOfMonth,
} from "@/lib/import/bank-csv";

/** A synthetic Revolut export (header as Revolut writes it; every value invented). */
const REVOLUT = [
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
  "CARD_PAYMENT,Current,2026-09-02 10:23:45,2026-09-03 09:00:01,Supermarché Exemple,-42.50,0.00,EUR,COMPLETED,957.50",
  "TOPUP,Current,2026-09-01 08:00:00,2026-09-01 08:00:02,Virement salaire,500.00,0.00,EUR,COMPLETED,1000.00",
  "CARD_PAYMENT,Current,2026-09-05 12:00:00,,Café Exemple,-3.20,0.00,EUR,PENDING,",
  "CARD_PAYMENT,Current,2026-09-06 12:00:00,2026-09-07 12:00:00,Shop US,-10.00,0.00,USD,COMPLETED,90.00",
  "EXCHANGE,Current,2026-09-08 12:00:00,2026-09-08 12:00:01,Change,-20.00,0.50,EUR,COMPLETED,936.00",
  "CARD_PAYMENT,Current,2026-09-09 12:00:00,2026-09-09 12:00:01,Annulé,-15.00,0.00,EUR,REVERTED,936.00",
  'CARD_PAYMENT,Current,2026-08-30 12:00:00,2026-08-31 12:00:01,"Resto, ""Le Petit""",-25.00,0.00,EUR,COMPLETED,911.00',
].join("\n");

describe("CSV basics", () => {
  it("decodes UTF-8 (without BOM) and falls back to Windows-1252", () => {
    expect(decodeCsv(new TextEncoder().encode("﻿Libellé;Montant"))).toBe("Libellé;Montant");
    // "é" in Windows-1252 is 0xE9, invalid on its own in UTF-8.
    expect(decodeCsv(new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9]))).toBe("Libellé");
  });

  it("detects the separator and parses quoted cells", () => {
    expect(detectSeparator("Date;Libellé;Montant\n")).toBe(";");
    expect(detectSeparator('Date,"Libellé; détail",Montant')).toBe(",");
    expect(parseCsv('a;"b;c";"d ""e"""\r\n\r\n1;2;3', ";")).toEqual([
      ["a", "b;c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    expect(parseCsv('"multi\nline";x', ";")).toEqual([["multi\nline", "x"]]);
  });

  it("reads French and international amounts", () => {
    expect(parseCsvAmount("1 234,56", ",")).toBe(123_456);
    expect(parseCsvAmount("-42,5 €", ",")).toBe(-4_250);
    expect(parseCsvAmount("1.234,56", ",")).toBe(123_456);
    expect(parseCsvAmount("-1,234.56", ".")).toBe(-123_456);
    expect(parseCsvAmount("(12,00)", ",")).toBe(-1_200);
    expect(parseCsvAmount("", ",")).toBeNull();
    expect(parseCsvAmount("abc", ",")).toBeNull();
  });

  it("reads dates", () => {
    expect(parseCsvDate("25/09/2026", "dmy")).toBe("2026-09-25");
    expect(parseCsvDate("1.9.26", "dmy")).toBe("2026-09-01");
    expect(parseCsvDate("2026-09-25 10:23:45", "ymd")).toBe("2026-09-25");
    expect(parseCsvDate("31/09/2026", "dmy")).toBeNull();
    expect(parseCsvDate("", "dmy")).toBeNull();
  });
});

describe("AC-07 — a Revolut export is read without mapping", () => {
  const rows = parseCsv(REVOLUT, detectSeparator(REVOLUT));

  it("is recognised from its header", () => {
    expect(isRevolut(rows[0]!)).toBe(true);
    expect(isRevolut(["Date", "Libellé", "Montant"])).toBe(false);
  });

  it("keeps completed EUR rows, amount − fee, dated by completion", () => {
    const { transactions, ignored } = readRevolut(rows);
    expect(transactions).toEqual([
      { line: 2, date: "2026-09-03", label: "Supermarché Exemple", amount: -4_250 },
      { line: 3, date: "2026-09-01", label: "Virement salaire", amount: 50_000 },
      { line: 6, date: "2026-09-08", label: "Change", amount: -2_050 },
      { line: 8, date: "2026-08-31", label: 'Resto, "Le Petit"', amount: -2_500 },
    ]);
    expect(ignored).toEqual([
      { line: 4, label: "Café Exemple", reason: "opération en attente" },
      { line: 5, label: "Shop US", reason: "devise USD" },
      { line: 7, label: "Annulé", reason: "opération annulée" },
    ]);
  });
});

describe("AC-01 / AC-02 — mapped banks and the chosen month", () => {
  const FR = ["Date opération;Libellé;Débit;Crédit", "01/09/2026;SALAIRE;;2 600,00", "15/09/2026;CARREFOUR;123,40;", "02/10/2026;LOYER;900,00;"].join("\n");
  const rows = parseCsv(FR, ";");

  it("guesses the columns and French formats, and reuses a mapping for the same header", () => {
    const mapping = guessMapping(rows[0]!, ";", rows.slice(1));
    expect(mapping).toMatchObject({ date: 0, label: 1, amount: null, debit: 2, credit: 3, decimal: ",", dateFormat: "dmy" });
    expect(sameHeader(mapping, rows[0]!)).toBe(true);
    expect(sameHeader(mapping, ["Date", "Libellé"])).toBe(false);
  });

  it("reads debit / credit columns and keeps only the month", () => {
    const mapping = guessMapping(rows[0]!, ";", rows.slice(1));
    const { transactions, ignored } = readMapped(rows, mapping);
    expect(ignored).toEqual([]);
    const { inMonth, outside } = transactionsOfMonth(transactions, "2026-09");
    expect(inMonth.map((t) => [t.date, t.label, t.amount])).toEqual([
      ["2026-09-01", "SALAIRE", 260_000],
      ["2026-09-15", "CARREFOUR", -12_340],
    ]);
    expect(outside).toBe(1);
  });

  it("reads a single signed amount column and reports unreadable rows", () => {
    const mapping: CsvMapping = {
      header: ["Date", "Label", "Amount"],
      separator: ",",
      date: 0,
      label: 1,
      amount: 2,
      debit: null,
      credit: null,
      decimal: ".",
      dateFormat: "ymd",
    };
    const result = readMapped(parseCsv("Date,Label,Amount\n2026-09-01,Pay,1500.00\nbad,Oops,1\n2026-09-02,Shop,x", ","), mapping);
    expect(result.transactions).toEqual([{ line: 2, date: "2026-09-01", label: "Pay", amount: 150_000 }]);
    expect(result.ignored.map((r) => r.reason)).toEqual(["date illisible", "montant illisible"]);
  });
});

describe("AC-03 / AC-04 — totals of the assigned transactions", () => {
  const categories: Record<string, "income" | "fixed" | "variable"> = { salary: "income", food: "variable", rent: "fixed" };
  const tx = (amount: number) => ({ line: 2, date: "2026-09-01", label: "x", amount });

  it("adds income lines, subtracts expenses, a refund lowers them, ignored rows count nowhere", () => {
    const totals = totalsOf([tx(260_000), tx(-12_340), tx(2_000), tx(-90_000), tx(-50_000)], ["salary", "food", "food", "rent", null], (id) => categories[id]);
    expect(totals).toEqual({ income: 260_000, expenses: 12_340 - 2_000 + 90_000 });
  });
});

describe("AC-06 — unreadable or wrong files are rejected", () => {
  it("refuses other formats, empty and too large files in French", () => {
    expect(checkCsvFile({ name: "releve.pdf", size: 100, type: "application/pdf" })).toContain("pas un PDF");
    expect(checkCsvFile({ name: "plan.xlsx", size: 100, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toContain(
      "export CSV",
    );
    expect(checkCsvFile({ name: "releve.csv", size: 0, type: "text/csv" })).toBe("Le fichier est vide.");
    expect(checkCsvFile({ name: "releve.csv", size: 6 * 1024 * 1024, type: "text/csv" })).toBe("Fichier trop volumineux : 5 Mo maximum.");
    expect(checkCsvFile({ name: "releve.csv", size: 100, type: "text/csv" })).toBeNull();
  });
});

describe("performance", () => {
  it("reads 2 000 transactions quickly", () => {
    const lines = ["Date;Libellé;Montant", ...Array.from({ length: 2000 }, (_, i) => `${String((i % 28) + 1).padStart(2, "0")}/09/2026;Achat ${i};-1${i},50`)];
    const text = lines.join("\n");
    const started = performance.now();
    const rows = parseCsv(text, detectSeparator(text));
    const { transactions } = readMapped(rows, guessMapping(rows[0]!, ";", rows.slice(1)));
    expect(transactions).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
