/**
 * JSON backup of everything the user entered (SPEC §10, issue #7). Inputs only: the plan is
 * recomputed from them. Pure: the caller loads the snapshot through the repository (RLS applies).
 */
import type { Cents, YearMonth } from "@/lib/engine";
import type { FinanceSnapshot, FrozenPlan, Loan } from "@/lib/domain/types";
import type { CsvMapping } from "@/lib/import/bank-csv";

export const BACKUP_FORMAT = "finance-plan-backup";
/**
 * Bump when the shape changes; an import reads older versions explicitly.
 * 1: first version (#7). 2: loans gain `penaltyPct` and `penaltyCapMonths` (IRA, #9).
 * 3: `goals` and check-ins' `goalBalances` (several savings goals, #10).
 * 4: loans gain `kind` and `creditLimit` (bank overdraft, #28).
 * 5: the primary goal is a goal like the others (real id); `settings` loses the moving fund and
 *    check-ins lose `movingSavings`, whose value is the primary goal's entry in `goalBalances`.
 * 6: `settings` gain `expenseInflationRate` and `incomeGrowthRate`, budget lines `indexed` (#36).
 * 7: `settings` gain `emergencyRate` and `freeSavingsRate`, goals `rate` (savings interest, #35).
 * 8: income lines gain `paydayDay` and `paydayPreviousMonth`; `incomePayments` (paydays, #60).
 * 9: `bankCsvMapping`, the saved column mapping of the bank CSV import (#38); never a transaction.
 * 10: `bankRules` and `bankLineTotals` (bank import rules and per-line totals, #63).
 * 11: check-ins gain `lines` (actual amount of each budget line, with a copy of its label and
 *     budget, #72); `bankLineTotals` is gone (the bank import pre-fills those rows).
 * 12: check-ins gain `deposits` (savings deposits per pot, #73); with deposits their balances are
 *     computed, so `emergencySavings`, `freeSavings` and `goalBalances` are 0 / empty.
 * 13: `bankAccounts` (named accounts, each with its CSV mapping) and check-ins' `statements` (the
 *     summary of each bank statement added to the month, #115); still never a transaction.
 */
export const BACKUP_VERSION = 13;

/** Euros with exactly 2 decimals and a dot ("1234.50", "-0.05"), computed from integer cents. */
export type DecimalEuros = string;

export function centsToDecimal(cents: Cents): DecimalEuros {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Not a whole number of cents: ${cents}`);
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${euros}.${rest}`;
}

const money = (cents: Cents | null): DecimalEuros | null => (cents === null ? null : centsToDecimal(cents));

export interface BackupLoan {
  id: string;
  name: string | null;
  type: string | null;
  principal: DecimalEuros;
  principalPaidThroughMonth: YearMonth | null;
  apr: number;
  monthlyPayment: DecimalEuros;
  contractEndMonth: YearMonth | null;
  /** IRA as a fraction of the capital repaid early; null = none (SPEC D22). */
  penaltyPct: number | null;
  /** Cap in months of interest; null = no cap. */
  penaltyCapMonths: number | null;
  /** "overdraft": `principal` = balance used, `monthlyPayment` = fixed repayment (SPEC D24). */
  kind: "loan" | "overdraft";
  /** Overdraft only: authorised amount; null for a loan. */
  creditLimit: DecimalEuros | null;
  position: number;
  /** ISO timestamp; null for an active loan (SPEC D8). */
  archivedAt: string | null;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO timestamp of the export. */
  exportedAt: string;
  data: {
    settings: {
      startMonth: YearMonth;
      emergencyTarget: DecimalEuros;
      emergencyExisting: DecimalEuros;
      freeSavingsExisting: DecimalEuros;
      riskFreeRate: number;
      earlyRepaymentPct: number;
      /** Yearly indexation, fractions (SPEC D27). */
      expenseInflationRate: number;
      incomeGrowthRate: number;
      /** Yearly savings interest, fractions (SPEC D28). */
      emergencyRate: number;
      freeSavingsRate: number;
    } | null;
    budgetLines: {
      id: string;
      category: string;
      label: string;
      amount: DecimalEuros;
      position: number;
      startMonth: YearMonth | null;
      endMonth: YearMonth | null;
      /** false = « non indexé » (SPEC D27). */
      indexed: boolean;
      /** Usual payday (SPEC D29); 1 and false for expense lines. */
      paydayDay: number;
      paydayPreviousMonth: boolean;
    }[];
    /** Actual payment dates that differ from the usual payday (SPEC D29), by month. */
    incomePayments: { month: YearMonth; budgetLineId: string; paidOn: string }[];
    /** Bank CSV column mapping (SPEC D30); null when none is saved. */
    bankCsvMapping: CsvMapping | null;
    /** Keyword → budget line (null = ignored) rules of the bank import (SPEC D31). */
    bankRules: { keyword: string; budgetLineId: string | null }[];
    /** Named bank accounts and their CSV mapping (#115). */
    bankAccounts: { id: string; name: string; mapping: CsvMapping | null }[];
    exceptions: { id: string; month: YearMonth; kind: string; label: string; amount: DecimalEuros }[];
    /** Active loans first (entry order), then archived ones. */
    loans: BackupLoan[];
    /** Savings goals in priority order, the primary one (`primary: true`) included (SPEC D23). */
    goals: {
      id: string;
      name: string;
      target: DecimalEuros;
      deadlineMonth: YearMonth;
      alreadySaved: DecimalEuros;
      priority: number;
      primary: boolean;
      /** Yearly interest rate, fraction (SPEC D28). */
      rate: number;
    }[];
    /** Oldest first. */
    checkIns: {
      id: string;
      month: YearMonth;
      income: DecimalEuros | null;
      expenses: DecimalEuros | null;
      emergencySavings: DecimalEuros;
      freeSavings: DecimalEuros;
      loanBalances: { loanId: string; balance: DecimalEuros }[];
      /** Every goal, the primary one included. */
      goalBalances: { goalId: string; balance: DecimalEuros }[];
      /** Savings deposits per pot (#73, SPEC D33); empty for check-ins with typed balances. */
      deposits: { pot: string; goalId: string | null; goalName: string | null; planned: DecimalEuros; amount: DecimalEuros }[];
      /** Actual amount per budget line, exception and « hors budget » row (#72); empty = « non détaillé ». */
      lines: {
        kind: string;
        direction: string;
        category: string | null;
        budgetLineId: string | null;
        exceptionId: string | null;
        label: string;
        planned: DecimalEuros;
        actual: DecimalEuros;
      }[];
      /** Bank statements added to the month's rows (#115): account, file, fingerprint and totals only. */
      statements: {
        accountId: string | null;
        accountName: string;
        fileName: string;
        fingerprint: string;
        transactionCount: number;
        totalIn: DecimalEuros;
        totalOut: DecimalEuros;
        lineTotals: { budgetLineId: string; actual: DecimalEuros }[];
      }[];
      frozen: {
        plannedDebt: DecimalEuros;
        plannedSavings: DecimalEuros;
        plannedIncome: DecimalEuros;
        plannedExpenses: DecimalEuros;
        planStartMonth: YearMonth;
      } | null;
    }[];
  };
}

function loan(l: Loan): BackupLoan {
  return {
    id: l.id,
    name: l.name,
    type: l.type,
    principal: centsToDecimal(l.principal),
    principalPaidThroughMonth: l.principalPaidThroughMonth,
    apr: l.apr,
    monthlyPayment: centsToDecimal(l.monthlyPayment),
    contractEndMonth: l.contractEndMonth,
    penaltyPct: l.penaltyPct,
    penaltyCapMonths: l.penaltyCapMonths,
    kind: l.kind,
    creditLimit: money(l.creditLimit),
    position: l.position,
    archivedAt: l.archivedAt,
  };
}

function frozen(f: FrozenPlan | null) {
  if (!f) return null;
  return {
    plannedDebt: centsToDecimal(f.plannedDebt),
    plannedSavings: centsToDecimal(f.plannedSavings),
    plannedIncome: centsToDecimal(f.plannedIncome),
    plannedExpenses: centsToDecimal(f.plannedExpenses),
    planStartMonth: f.planStartMonth,
  };
}

export function buildBackup(snapshot: FinanceSnapshot, now: Date = new Date()): Backup {
  const s = snapshot.settings;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      settings: s
        ? {
            startMonth: s.startMonth,
            emergencyTarget: centsToDecimal(s.emergencyTarget),
            emergencyExisting: centsToDecimal(s.emergencyExisting),
            freeSavingsExisting: centsToDecimal(s.freeSavingsExisting),
            riskFreeRate: s.riskFreeRate,
            earlyRepaymentPct: s.earlyRepaymentPct,
            expenseInflationRate: s.expenseInflationRate ?? 0,
            incomeGrowthRate: s.incomeGrowthRate ?? 0,
            emergencyRate: s.emergencyRate ?? 0,
            freeSavingsRate: s.freeSavingsRate ?? 0,
          }
        : null,
      budgetLines: snapshot.lines.map((l) => ({
        id: l.id,
        category: l.category,
        label: l.label,
        amount: centsToDecimal(l.amount),
        position: l.position,
        startMonth: l.startMonth,
        endMonth: l.endMonth,
        indexed: l.indexed !== false,
        paydayDay: l.paydayDay ?? 1,
        paydayPreviousMonth: l.paydayPreviousMonth ?? false,
      })),
      incomePayments: snapshot.incomePayments.map((p) => ({ month: p.month, budgetLineId: p.budgetLineId, paidOn: p.paidOn })),
      bankCsvMapping: snapshot.bankCsvMapping ?? null,
      bankRules: (snapshot.bankRules ?? []).map((r) => ({ keyword: r.keyword, budgetLineId: r.budgetLineId })),
      bankAccounts: (snapshot.bankAccounts ?? []).map((a) => ({ id: a.id, name: a.name, mapping: a.mapping })),
      exceptions: snapshot.exceptions.map((e) => ({
        id: e.id,
        month: e.month,
        kind: e.kind,
        label: e.label,
        amount: centsToDecimal(e.amount),
      })),
      loans: [...snapshot.loans, ...snapshot.archivedLoans].map(loan),
      goals: snapshot.goals.map((g) => ({
        id: g.id,
        name: g.name,
        target: centsToDecimal(g.target),
        deadlineMonth: g.deadlineMonth,
        alreadySaved: centsToDecimal(g.alreadySaved),
        priority: g.priority,
        primary: g.primary,
        rate: g.rate ?? 0,
      })),
      checkIns: snapshot.actuals.map((a) => ({
        id: a.id,
        month: a.month,
        income: money(a.income),
        expenses: money(a.expenses),
        emergencySavings: centsToDecimal(a.emergencySavings),
        freeSavings: centsToDecimal(a.freeSavings),
        loanBalances: a.loanBalances.map((b) => ({ loanId: b.loanId, balance: centsToDecimal(b.balance) })),
        goalBalances: a.goalBalances.map((b) => ({ goalId: b.goalId, balance: centsToDecimal(b.balance) })),
        deposits: (a.deposits ?? []).map((d) => ({ ...d, planned: centsToDecimal(d.planned), amount: centsToDecimal(d.amount) })),
        lines: a.lines.map((l) => ({ ...l, planned: centsToDecimal(l.planned), actual: centsToDecimal(l.actual) })),
        statements: (a.statements ?? []).map((st) => ({
          ...st,
          totalIn: centsToDecimal(st.totalIn),
          totalOut: centsToDecimal(st.totalOut),
          lineTotals: st.lineTotals.map((t) => ({ budgetLineId: t.budgetLineId, actual: centsToDecimal(t.actual) })),
        })),
        frozen: frozen(a.frozen),
      })),
    },
  };
}

/** Pretty-printed JSON, as downloaded. */
export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

/** "finance-backup-2026-09-28.json" (local date). */
export function backupFileName(now: Date = new Date()): string {
  return `finance-backup-${isoDate(now)}.json`;
}

export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
