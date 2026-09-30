/** JSON backup and plan CSV serialisers (issue #7). */
import { describe, expect, it } from "vitest";
import { computePlan } from "@/lib/domain/plan";
import type { FinanceSnapshot, MonthlyActual } from "@/lib/domain/types";
import { BACKUP_VERSION, backupFileName, buildBackup, centsToDecimal, serializeBackup } from "@/lib/export/backup";
import { csvAmount, csvText, planCsvFileName, planToCsv } from "@/lib/export/csv";
import { makeLoan, makeSettings, makeSnapshot } from "../components/helpers";

const NOW = new Date(2026, 8, 28, 10, 30);

const checkIn: MonthlyActual = {
  id: "act-1",
  month: "2026-02",
  income: null,
  expenses: 123456,
  emergencySavings: 0,
  freeSavings: 5,
  loanBalances: [{ loanId: "loan-1", balance: 450000 }],
  goalBalances: [{ goalId: "goal-primary", balance: 10000 }],
  frozen: { plannedDebt: 1, plannedSavings: 2, plannedIncome: 3, plannedExpenses: 4, planStartMonth: "2026-01" },
};

const full: FinanceSnapshot = makeSnapshot({
  settings: makeSettings(),
  lines: [
    { id: "l1", category: "income", label: "Salaire", amount: 250000, position: 0, startMonth: null, endMonth: null },
    { id: "l2", category: "fixed", label: "Électricité; gaz", amount: 8050, position: 0, startMonth: "2026-03", endMonth: null },
  ],
  exceptions: [{ id: "e1", month: "2026-06", kind: "expense", label: "Vacances", amount: 90000 }],
  loans: [makeLoan(1)],
  archivedLoans: [makeLoan(2, { archivedAt: "2026-05-01T00:00:00Z" })],
  actuals: [checkIn],
});

describe("centsToDecimal", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [-5, "-0.05"],
    [123456, "1234.56"],
    [100000000, "1000000.00"],
    [-250010, "-2500.10"],
  ])("%i cents → %s", (cents, text) => expect(centsToDecimal(cents)).toBe(text));

  it("refuses fractional cents", () => expect(() => centsToDecimal(0.5)).toThrow(RangeError));
});

describe("buildBackup", () => {
  it("is versioned and timestamped", () => {
    const b = buildBackup(full, NOW);
    expect(b.format).toBe("finance-plan-backup");
    expect(b.version).toBe(BACKUP_VERSION);
    expect(b.exportedAt).toBe(NOW.toISOString());
  });

  it("contains every collection with 2-decimal amounts and YYYY-MM months", () => {
    const { data } = buildBackup(full, NOW);
    expect(data.settings).toMatchObject({ startMonth: "2026-01", emergencyExisting: "1000.00", riskFreeRate: 0.03 });
    expect(data.settings).not.toHaveProperty("movingGoal");
    expect(data.goals).toEqual([
      { id: "goal-primary", name: "Déménagement", target: "3000.00", deadlineMonth: "2026-12", alreadySaved: "0.00", priority: 1, primary: true, rate: 0 },
    ]);
    expect(data.budgetLines.map((l) => [l.label, l.amount, l.startMonth])).toEqual([
      ["Salaire", "2500.00", null],
      ["Électricité; gaz", "80.50", "2026-03"],
    ]);
    expect(data.exceptions).toEqual([{ id: "e1", month: "2026-06", kind: "expense", label: "Vacances", amount: "900.00" }]);
    expect(data.loans.map((l) => [l.id, l.principal, l.monthlyPayment, l.archivedAt])).toEqual([
      ["loan-1", "5000.00", "200.00", null],
      ["loan-2", "5000.00", "200.00", "2026-05-01T00:00:00Z"],
    ]);
    expect(data.checkIns).toEqual([
      {
        id: "act-1",
        month: "2026-02",
        income: null,
        expenses: "1234.56",
        emergencySavings: "0.00",
        freeSavings: "0.05",
        loanBalances: [{ loanId: "loan-1", balance: "4500.00" }],
        goalBalances: [{ goalId: "goal-primary", balance: "100.00" }],
        frozen: { plannedDebt: "0.01", plannedSavings: "0.02", plannedIncome: "0.03", plannedExpenses: "0.04", planStartMonth: "2026-01" },
      },
    ]);
  });

  it("is valid JSON with empty arrays for a new user", () => {
    const parsed = JSON.parse(serializeBackup(buildBackup(makeSnapshot(), NOW)));
    expect(parsed.data).toEqual({ settings: null, budgetLines: [], incomePayments: [], bankCsvMapping: null, bankRules: [], bankLineTotals: [], exceptions: [], loans: [], goals: [], checkIns: [] });
  });

  it("names the file after the local date", () => {
    expect(backupFileName(NOW)).toBe("finance-backup-2026-09-28.json");
    expect(planCsvFileName(NOW)).toBe("finance-plan-2026-09-28.csv");
  });
});

describe("csvText", () => {
  it("leaves plain text alone", () => expect(csvText("Électricité", ";")).toBe("Électricité"));
  it("quotes the separator, quotes and line breaks", () => {
    expect(csvText("a;b", ";")).toBe('"a;b"');
    expect(csvText("a;b", ",")).toBe("a;b");
    expect(csvText('dit "oui"', ";")).toBe('"dit ""oui"""');
    expect(csvText("ligne\nsuite", ";")).toBe('"ligne\nsuite"');
  });
  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx"])("neutralises formula %j", (v) => {
    expect(csvText(v, ";").replace(/^"/, "").startsWith("'")).toBe(true);
  });
});

describe("csvAmount", () => {
  it("French: decimal comma; international: dot; always 2 decimals", () => {
    expect(csvAmount(0, "fr")).toBe("0,00");
    expect(csvAmount(-12345, "fr")).toBe("-123,45");
    expect(csvAmount(100000000, "intl")).toBe("1000000.00");
  });
});

describe("planToCsv", () => {
  const plan = computePlan({ ...full, loans: [makeLoan(1, { name: "=Prêt; auto" })] }, "2026-01")!;

  it("has a BOM, a header and 300 rows in the French format", () => {
    const csv = planToCsv(plan.result, "fr");
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines.at(-1)).toBe("");
    const rows = lines.slice(1, -1);
    expect(rows).toHaveLength(300);
    const header = lines[0]!.split(";");
    expect(header.slice(0, 3)).toEqual(["Mois", "N°", "Revenus"]);
    // The loan name is quoted: it contains the separator.
    expect(lines[0]).toContain(`"Restant dû =Prêt; auto"`);
    const first = rows[0]!.split(";");
    expect(first[0]).toBe("2026-01");
    expect(first[1]).toBe("1");
    expect(first[2]).toBe("2500,00");
    expect(rows[299]!.startsWith("2050-12;300;")).toBe(true);
    for (const row of rows) {
      for (const cell of row.split(";").slice(2, -1)) expect(cell).toMatch(/^-?\d+,\d{2}$/);
    }
  });

  it("uses , and a decimal dot in the international format", () => {
    const rows = planToCsv(plan.result, "intl").split("\r\n");
    expect(rows[1]!.split(",").slice(0, 3)).toEqual(["2026-01", "1", "2500.00"]);
  });
});
