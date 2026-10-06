/** Several bank statements per month (issue #115): summing, removing, transfers, duplicates, mappings. */
import { describe, expect, it } from "vitest";
import type { BankTransaction, CsvMapping } from "@/lib/import/bank-csv";
import {
  addLineTotals,
  daysApart,
  isDuplicate,
  mappingFor,
  pairTransfers,
  parseStatements,
  statementFingerprint,
  statementTotals,
} from "@/lib/import/statements";

const tx = (line: number, date: string, label: string, amount: number): BankTransaction => ({ line, date, label, amount });

describe("statementFingerprint", () => {
  const a = [tx(2, "2026-09-01", "Salaire", 260_000), tx(3, "2026-09-15", "Carrefour Market", -12_340)];

  it("is 16 hex digits and ignores the order, the file lines and the label's case and accents", () => {
    const fp = statementFingerprint(a);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(statementFingerprint([tx(9, "2026-09-15", "CARREFOUR  marché", -12_340), tx(8, "2026-09-01", "salaire", 260_000)].map((t) => ({ ...t, label: t.label.replace("marché", "Market") })))).toBe(fp);
  });

  it("changes with a date, an amount or a transaction", () => {
    const fp = statementFingerprint(a);
    expect(statementFingerprint([a[0]!, { ...a[1]!, amount: -12_341 }])).not.toBe(fp);
    expect(statementFingerprint([a[0]!, { ...a[1]!, date: "2026-09-16" }])).not.toBe(fp);
    expect(statementFingerprint([a[0]!])).not.toBe(fp);
  });
});

describe("statementTotals", () => {
  it("sums money in and out", () => {
    expect(statementTotals([tx(1, "", "", 1_000), tx(2, "", "", -250), tx(3, "", "", -50)])).toEqual({ totalIn: 1_000, totalOut: 300 });
  });
});

describe("isDuplicate (AC-05)", () => {
  const known = [{ account: { id: "rev" }, fingerprint: "aaaaaaaaaaaaaaaa" }, { account: { name: "BNP" }, fingerprint: "bbbbbbbbbbbbbbbb" }];

  it("refuses the same transactions in the same account only", () => {
    expect(isDuplicate(known, { id: "rev" }, "aaaaaaaaaaaaaaaa")).toBe(true);
    expect(isDuplicate(known, { id: "other" }, "aaaaaaaaaaaaaaaa")).toBe(false);
    expect(isDuplicate(known, { id: "rev" }, "cccccccccccccccc")).toBe(false);
    // A new account (or one deleted since) is matched by name, ignoring case.
    expect(isDuplicate(known, { name: " bnp " }, "bbbbbbbbbbbbbbbb")).toBe(true);
  });
});

describe("mappingFor (AC-03)", () => {
  const mapping = (header: string[]): CsvMapping => ({ header, separator: ";", date: 0, label: 1, amount: 2, debit: null, credit: null, decimal: ",", dateFormat: "dmy" });
  const bnp = mapping(["Date", "Libellé", "Montant"]);
  const other = mapping(["Jour", "Texte", "Somme"]);

  it("reuses the account's mapping for the same header only", () => {
    expect(mappingFor({ mapping: bnp }, ["Date", "Libellé", "Montant"])).toBe(bnp);
    expect(mappingFor({ mapping: bnp }, ["Jour", "Texte", "Somme"])).toBeNull();
  });

  it("offers the pre-#115 per-user mapping to an account without one", () => {
    expect(mappingFor(null, ["Jour", "Texte", "Somme"], other)).toBe(other);
    expect(mappingFor({ mapping: null }, ["Jour", "Texte", "Somme"], other)).toBe(other);
    // An account that has its own mapping never takes the old one.
    expect(mappingFor({ mapping: bnp }, ["Jour", "Texte", "Somme"], other)).toBeNull();
  });
});

describe("pairTransfers (AC-04)", () => {
  const main = (transactions: BankTransaction[]) => ({ account: { id: "bnp" }, transactions });
  const revolut = (transactions: BankTransaction[]) => ({ account: { id: "rev" }, transactions });

  it("pairs a debit and a credit of the same amount in two accounts, up to 3 days apart", () => {
    const pairs = pairTransfers([main([tx(2, "2026-09-02", "Virement vers Revolut", -50_000)]), revolut([tx(2, "2026-09-05", "Top-up", 50_000)])]);
    expect(pairs).toEqual([{ out: { statement: 0, index: 0 }, in: { statement: 1, index: 0 }, amount: 50_000 }]);
  });

  it("does not pair 4 days apart, 1 cent off, nor within one account", () => {
    expect(pairTransfers([main([tx(2, "2026-09-02", "A", -50_000)]), revolut([tx(2, "2026-09-06", "B", 50_000)])])).toEqual([]);
    expect(pairTransfers([main([tx(2, "2026-09-02", "A", -50_000)]), revolut([tx(2, "2026-09-03", "B", 50_001)])])).toEqual([]);
    expect(pairTransfers([main([tx(2, "2026-09-02", "A", -50_000)]), main([tx(2, "2026-09-02", "B", 50_000)])])).toEqual([]);
  });

  it("uses each leg once, the closest dates first, across three accounts", () => {
    const pairs = pairTransfers([
      main([tx(2, "2026-09-01", "Vers Revolut", -10_000), tx(3, "2026-09-10", "Vers Livret", -10_000)]),
      revolut([tx(2, "2026-09-03", "Top-up", 10_000)]),
      { account: { name: "Livret" }, transactions: [tx(2, "2026-09-10", "Versement", 10_000)] },
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ out: { statement: 0, index: 1 }, in: { statement: 2, index: 0 }, amount: 10_000 });
    expect(pairs).toContainEqual({ out: { statement: 0, index: 0 }, in: { statement: 1, index: 0 }, amount: 10_000 });
  });

  it("pairs legs on both sides of a month end when both are in the files", () => {
    expect(daysApart("2026-08-31", "2026-09-02")).toBe(2);
    expect(pairTransfers([main([tx(2, "2026-08-31", "A", -7_500)]), revolut([tx(2, "2026-09-02", "B", 7_500)])])).toHaveLength(1);
  });

  it("never pairs a refund with a purchase in another account (both are money in or both out)", () => {
    expect(pairTransfers([main([tx(2, "2026-09-02", "Achat", -4_000)]), revolut([tx(2, "2026-09-03", "Achat", -4_000)])])).toEqual([]);
  });
});

describe("addLineTotals (AC-01, AC-02)", () => {
  const rows = [
    { key: "salary", kind: "line", budgetLineId: "salary" },
    { key: "food", kind: "line", budgetLineId: "food" },
    { key: "rent", kind: "line", budgetLineId: "rent" },
    { key: "other-expense", kind: "other", budgetLineId: null },
  ];
  const lines = (values: Record<string, string>) => rows.map((r) => ({ key: r.key, actual: values[r.key] ?? "" }));
  const read = (result: { key: string; actual: string }[]) => Object.fromEntries(result.map((l) => [l.key, l.actual]));

  it("adds to the rows, fills empty budget-line rows with 0, never touches « hors budget »", () => {
    expect(read(addLineTotals(lines({ food: "420", rent: "850" }), rows, [{ budgetLineId: "food", actual: 8_000 }], 1))).toEqual({
      salary: "0,00",
      food: "500,00",
      rent: "850",
      "other-expense": "",
    });
  });

  it("subtracts exactly a statement's amounts, refunds included", () => {
    const totals = [
      { budgetLineId: "food", actual: 8_000 },
      { budgetLineId: "salary", actual: -1_000 },
    ];
    expect(read(addLineTotals(lines({ food: "500", salary: "2 600" }), rows, totals, -1))).toEqual({
      salary: "2610,00",
      food: "420,00",
      rent: "",
      "other-expense": "",
    });
  });

  it("leaves a row typed wrong as it is", () => {
    expect(read(addLineTotals(lines({ food: "abc" }), rows, [{ budgetLineId: "food", actual: 8_000 }], 1)).food).toBe("abc");
  });
});

describe("parseStatements (security)", () => {
  const ctx = { accountIds: new Set(["rev"]), lineIds: new Set(["food"]) };
  const statement = {
    accountId: "rev",
    accountName: "Revolut",
    fileName: "releve.csv",
    fingerprint: "0123456789abcdef",
    transactionCount: 3,
    totalIn: 100,
    totalOut: 200,
    lineTotals: [
      { budgetLineId: "food", actual: 200 },
      { budgetLineId: "deleted-line", actual: 50 },
    ],
  };

  it("keeps the user's accounts and lines, dropping totals of lines that no longer exist", () => {
    expect(parseStatements(JSON.stringify([statement]), ctx)).toEqual([{ ...statement, lineTotals: [{ budgetLineId: "food", actual: 200 }] }]);
    expect(parseStatements(JSON.stringify([{ ...statement, accountId: null }]), ctx)?.[0]?.accountId).toBeNull();
    expect(parseStatements("", ctx)).toEqual([]);
  });

  it("rejects another user's account, bad JSON, fractional cents, a bad fingerprint or too many statements", () => {
    expect(parseStatements(JSON.stringify([{ ...statement, accountId: "someone-else" }]), ctx)).toBeNull();
    expect(parseStatements("{", ctx)).toBeNull();
    expect(parseStatements(JSON.stringify([{ ...statement, totalIn: 1.5 }]), ctx)).toBeNull();
    expect(parseStatements(JSON.stringify([{ ...statement, fingerprint: "<script>" }]), ctx)).toBeNull();
    expect(parseStatements(JSON.stringify(Array.from({ length: 21 }, () => statement)), ctx)).toBeNull();
  });
});
