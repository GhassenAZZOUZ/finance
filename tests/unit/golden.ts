/**
 * Loader + adapters for tests/fixtures/golden.json (produced by Excel, see docs/SPEC.md §9).
 * Converts the spreadsheet's euro values into engine inputs and engine outputs back into the
 * spreadsheet's exact strings, so the tests compare like with like.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ActualInput,
  type ActualStatus,
  type DebtAlert,
  type LoanAdvice,
  type PlanInput,
  type PlanKpis,
  eurosToCents,
} from "@/lib/engine";

type Num = number | null;

export interface GoldenLine {
  label: string;
  amount: number;
}
export interface GoldenLoan {
  slot: number;
  name: string | null;
  type: string | null;
  principal: Num;
  apr: Num;
  monthlyPayment: Num;
}
export interface GoldenActual {
  month: string;
  income: Num;
  expenses: Num;
  movingSavings: Num;
  emergencySavings: Num;
  freeSavings: Num;
  loanBalances: Num[];
}
export interface GoldenScenario {
  id: string;
  description: string;
  inputs: {
    budget: {
      incomeLines: GoldenLine[];
      fixedCostLines: GoldenLine[];
      variableExpenseLines: GoldenLine[];
      startMonth: string;
      movingGoal: number;
      movingDeadlineMonth: string;
      movingAlreadySaved: number;
      emergencyTarget: number;
      emergencyExisting: number;
      riskFreeRate: number;
      earlyRepaymentPct: number;
    };
    loans: GoldenLoan[];
    actuals: GoldenActual[];
  };
  expected: {
    credits: Array<{
      slot: number;
      payoffMonthWithPlan: string | null;
      payoffMonthWithoutPlan: string | null;
      interestWithPlan: number;
      interestWithoutPlan: number;
      earlyRepaymentWorthIt: string | null;
      priority: Num;
      advice: string | null;
    }>;
    creditsTotals: { principal: number; weightedApr: number; monthlyPayments: number };
    plan: Array<Record<string, number | string | boolean>>;
    calcul: Array<{
      month: number;
      loans: number[][];
      totalPayments: number;
      totalEarlyRepayment: number;
      totalEndDebt: number;
      totalInterest: number;
      totalBaselineInterest: number;
    }>;
    synthese: Record<string, number | string>;
    suivi: Array<Record<string, number | string>>;
  };
}
export interface GoldenFile {
  horizonMonths: number;
  calculLoanColumns: string[];
  scenarios: GoldenScenario[];
}

export function loadGolden(): GoldenFile {
  const path = join(process.cwd(), "tests", "fixtures", "golden.json");
  return JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
}

const sumLines = (lines: GoldenLine[]) => lines.reduce((acc, l) => acc + eurosToCents(l.amount), 0);

/** Filled loan slots (principal present), with their 1-based slot number. */
export function activeSlots(s: GoldenScenario): GoldenLoan[] {
  return s.inputs.loans.filter((l) => l.principal !== null);
}

export function toPlanInput(s: GoldenScenario): PlanInput {
  const b = s.inputs.budget;
  return {
    budget: {
      income: sumLines(b.incomeLines),
      fixedCosts: sumLines(b.fixedCostLines),
      variableExpenses: sumLines(b.variableExpenseLines),
      startMonth: b.startMonth,
      movingGoal: eurosToCents(b.movingGoal),
      movingDeadlineMonth: b.movingDeadlineMonth,
      movingAlreadySaved: eurosToCents(b.movingAlreadySaved),
      emergencyTarget: eurosToCents(b.emergencyTarget),
      emergencyExisting: eurosToCents(b.emergencyExisting),
      riskFreeRate: b.riskFreeRate,
      earlyRepaymentPct: b.earlyRepaymentPct,
    },
    loans: activeSlots(s).map((l) => ({
      id: `slot-${l.slot}`,
      name: l.name,
      principal: eurosToCents(l.principal ?? 0),
      apr: l.apr ?? 0,
      monthlyPayment: eurosToCents(l.monthlyPayment ?? 0),
    })),
  };
}

export function toActualInputs(s: GoldenScenario): ActualInput[] {
  return s.inputs.actuals.map((a) => ({
    month: a.month,
    income: a.income === null ? null : eurosToCents(a.income),
    expenses: a.expenses === null ? null : eurosToCents(a.expenses),
    movingSavings: eurosToCents(a.movingSavings ?? 0),
    emergencySavings: eurosToCents(a.emergencySavings ?? 0),
    freeSavings: eurosToCents(a.freeSavings ?? 0),
    loanBalances: a.loanBalances.map((v) => eurosToCents(v ?? 0)),
  }));
}

// ---- engine values -> the spreadsheet's exact strings -------------------------------------

export const ADVICE_LABEL: Record<LoanAdvice, string> = {
  highRate: "Taux élevé : à solder en priorité",
  worthIt: "Remb. anticipé intéressant (vérifier IRA)",
  keep: "Garder, épargner plutôt",
};
export const DEBT_ALERT_LABEL: Record<DebtAlert, string> = {
  ok: "OK",
  warning: "Proche du seuil",
  alert: "Au-dessus de 35 %",
};
export const STATUS_LABEL: Record<ActualStatus, string> = {
  onTrack: "✅ Dans les temps",
  late: "🔴 En retard",
  mixed: "🟠 Mitigé",
};

export function movingReachedLabel(k: PlanKpis): string {
  return k.movingReachedMonth ?? "Non atteint";
}
export function movingStatusLabel(k: PlanKpis): string {
  return k.movingGoalMet ? "Objectif tenu" : "Objectif NON tenu : réduire dépenses ou décaler la date";
}
export function emergencyReachedLabel(k: PlanKpis): string {
  return k.emergencyReachedMonth ?? "Non atteint (25 ans)";
}
export function debtFreeLabel(k: PlanKpis): string {
  if (!k.hasDebt) return "Aucune dette";
  return k.debtFreeMonth ?? "Au-delà de 25 ans";
}
