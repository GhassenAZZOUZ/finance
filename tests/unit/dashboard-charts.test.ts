/** Dashboard charts of issues #86–#92: series in euros and text alternatives. */
import { describe, expect, it } from "vitest";
import {
  LOAN_BANDS,
  OTHER_LOANS_KEY,
  debtByLoanSeries,
  debtByLoanSummary,
  gapTone,
  gapsSeries,
  gapsSummary,
  goalsTarget,
  incomeUsesSeries,
  incomeUsesSummary,
  interestSeries,
  interestSummary,
  latestSpending,
  loanBands,
  loanPayoffLines,
  netWorthCrossing,
  netWorthOf,
  netWorthSeries,
  netWorthSummary,
  spendingSummary,
} from "@/app/(app)/_dashboard/chart-series";
import type { ActualLine } from "@/lib/domain/actual-lines";
import type { MonthlyActual } from "@/lib/domain/types";
import { type ActualComparison, type LoanInput, type LoanSummary, type PlanInput, simulatePlan, sumCents } from "@/lib/engine";

const budget: PlanInput["budget"] = {
  income: 250000,
  fixedCosts: 100000,
  variableExpenses: 50000,
  startMonth: "2027-01",
  movingGoal: 300000,
  movingDeadlineMonth: "2027-06",
  movingAlreadySaved: 0,
  emergencyTarget: 200000,
  emergencyExisting: 0,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.5,
};
const loan = (id: string, principal: number, apr: number, monthlyPayment: number, extra: Partial<LoanInput> = {}): LoanInput => ({
  id,
  name: id,
  principal,
  apr,
  monthlyPayment,
  ...extra,
});
const input: PlanInput = {
  budget,
  loans: [loan("auto", 500000, 0.12, 20000, { penaltyPct: 0.03 }), loan("perso", 300000, 0.05, 15000)],
};
const result = simulatePlan(input);
const { months, kpis, loans } = result;

const comparison = (month: string, c: Partial<ActualComparison> = {}): ActualComparison => ({
  month,
  planIndex: null,
  actualDebt: 0,
  plannedDebt: null,
  debtGap: null,
  actualSavings: 0,
  plannedSavings: null,
  savingsGap: null,
  movingGoalPct: 0,
  debtRepaidPct: 0,
  status: null,
  incomeGap: null,
  expensesGap: null,
  ...c,
});

describe("#86 goalsTarget", () => {
  it("sums every goal's target", () => {
    expect(goalsTarget({ goals: [{ target: 300000 }, { target: 50000 }] as never })).toBe(350000);
    expect(goalsTarget(kpis)).toBe(300000);
  });
});

describe("#90 net worth", () => {
  it("AC-01 — savings minus debt, in euros, with the actual net worth on checked-in months only", () => {
    const series = netWorthSeries(months, [comparison("2027-03", { actualSavings: 400000, actualDebt: 1000000 })]);
    expect(series).toHaveLength(24);
    const m = months[2]!;
    expect(series[2]).toEqual({
      month: "2027-03",
      label: "mars 2027",
      planned: (m.movingCumulative + m.emergencyCumulative + m.freeSavingsCumulative - m.remainingDebt) / 100,
      actual: -6000,
    });
    expect(series[1]!.actual).toBeNull();
  });

  it("AC-02 — the month it turns positive", () => {
    const crossing = netWorthCrossing(months);
    expect(crossing.kind).toBe("crosses");
    if (crossing.kind !== "crosses") return;
    const index = months.findIndex((m) => m.month === crossing.month);
    expect(netWorthOf(months[index]!)).toBeGreaterThanOrEqual(0);
    expect(netWorthOf(months[index - 1]!)).toBeLessThan(0);
    expect(netWorthSummary(months, [])).toContain("Patrimoine positif en");
  });

  it("AC-03 — already positive, or never positive", () => {
    const noDebt = simulatePlan({ budget, loans: [] }).months;
    expect(netWorthCrossing(noDebt)).toEqual({ kind: "alreadyPositive", month: "2027-01" });
    expect(netWorthSummary(noDebt, [])).toContain("Patrimoine positif dès janvier 2027");
    const broke = simulatePlan({ budget: { ...budget, income: 150000 }, loans: [loan("big", 5000000, 0.05, 1000)] }).months;
    expect(netWorthCrossing(broke)).toEqual({ kind: "never" });
    expect(netWorthSummary(broke, [])).toContain("négatif sur toute la durée du plan");
  });

  it("mentions the latest actual net worth", () => {
    const text = netWorthSummary(months, [comparison("2027-02", { actualSavings: 100000, actualDebt: 300000 })]);
    expect(text).toMatch(/Réel en février 2027 : -2\s000,00\s€/);
  });
});

describe("#89 interest", () => {
  it("AC-01 — two non-decreasing cumulative lines", () => {
    const series = interestSeries(months);
    expect(series).toHaveLength(24);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.withPlan).toBeGreaterThanOrEqual(series[i - 1]!.withPlan);
      expect(series[i]!.withoutPlan).toBeGreaterThanOrEqual(series[i - 1]!.withoutPlan);
    }
    expect(series[0]!.withPlan).toBe((months[0]!.totalInterest + months[0]!.totalPenalty) / 100);
  });

  it("AC-02 — over the whole plan, the final gap is « intérêts économisés » to the cent (penalties included)", () => {
    expect(kpis.penaltiesPaid ?? sumCents(months.map((m) => m.totalPenalty))).toBeGreaterThan(0);
    const end = interestSeries(months, months.length).at(-1)!;
    expect(Math.round(end.withoutPlan * 100) - Math.round(end.withPlan * 100)).toBe(kpis.interestSaved);
  });

  it("summarises the window", () => {
    expect(interestSummary(months)).toMatch(/^Intérêts cumulés sur 24 mois, jusqu’en décembre 2028 : .* économisés\.$/);
    expect(interestSummary([])).toBe("Aucune donnée.");
  });
});

describe("#88 debt by loan", () => {
  it("AC-01 — one band per loan, in repayment order", () => {
    const bands = loanBands(loans);
    const first = loans.findIndex((l) => l.priority === 1);
    expect(bands.map((b) => b.loanIndexes)).toEqual([[first], [1 - first]]);
    expect(bands.map((b) => b.slot)).toEqual([0, 1]);
  });

  it("AC-02 — the bands sum to the remaining debt every month", () => {
    const bands = loanBands(loans);
    const series = debtByLoanSeries(months, bands);
    series.forEach((p, i) => {
      const sum = bands.reduce((s, b) => s + Math.round((p[b.key] as number) * 100), 0);
      expect(sum).toBe(months[i]!.remainingDebt);
      expect(p.baseline).toBe(sumCents(months[i]!.loans.map((l) => l.baselineEndBalance)) / 100);
    });
  });

  it("AC-03 — payoff months are listed", () => {
    const lines = loanPayoffLines(loans, loanBands(loans));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => / : soldé en \p{L}+ \d{4}$/u.test(l))).toBe(true);
    expect(debtByLoanSummary(months, loans)).toContain("soldé en");
  });

  it("AC-03 — a loan's band ends at its payoff month", () => {
    const bands = loanBands(loans);
    const series = debtByLoanSeries(months, bands, months.length);
    for (const band of bands) {
      const payoff = loans[band.loanIndexes[0]!]!.payoffMonthWithPlan!;
      const at = series.findIndex((p) => p.month === payoff);
      expect(at).toBeGreaterThan(0);
      expect(series[at - 1]![band.key]).toBeGreaterThan(0);
      expect(series.slice(at).every((p) => p[band.key] === 0)).toBe(true);
    }
  });

  it("folds loans beyond the colour slots into « Autres crédits »; an overdraft is not « soldé »", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      id: `l${i}`,
      kind: i === 5 ? "overdraft" : "loan",
      displayName: `Crédit ${i + 1}`,
      priority: i + 1,
      payoffMonthWithPlan: "2028-01",
    })) as LoanSummary[];
    const bands = loanBands(many);
    expect(bands).toHaveLength(LOAN_BANDS);
    expect(bands.at(-1)).toMatchObject({ key: OTHER_LOANS_KEY, loanIndexes: [3, 4, 5], slot: null });
    expect(loanPayoffLines(many, bands).at(-1)).toBe("Crédit 6 : découvert renouvelable");
  });
});

describe("#87 income uses", () => {
  it("AC-01 — the segments sum to the month's income", () => {
    const series = incomeUsesSeries(months, 0);
    expect(series).toHaveLength(12);
    for (const p of series) {
      const total = p.expenses + p.loanPayments + p.goals + p.emergency + p.earlyRepayment + p.freeSavings;
      expect(Math.round(total * 100)).toBe(Math.round(p.income * 100));
    }
  });

  it("AC-02 — a loan ending moves its payment to savings and early repayment", () => {
    const short = simulatePlan({ budget: { ...budget, earlyRepaymentPct: 0 }, loans: [loan("short", 60000, 0, 20000)] }).months;
    const series = incomeUsesSeries(short, 0);
    const end = series.findIndex((p) => p.loanPayments === 0);
    expect(end).toBeGreaterThan(0);
    const before = series[end - 1]!;
    const after = series[end]!;
    const saved = (p: typeof before) => p.goals + p.emergency + p.earlyRepayment + p.freeSavings;
    expect(Math.round((saved(after) - saved(before)) * 100)).toBe(Math.round(before.loanPayments * 100));
  });

  it("AC-03 — a negative month has its shortfall below zero and is named in the summary", () => {
    const negative = simulatePlan({ budget: { ...budget, income: 140000 }, loans: [] }).months;
    const p = incomeUsesSeries(negative, 0)[0]!;
    expect(p.negative).toBe(true);
    expect(p.shortfall).toBe(-100);
    expect(incomeUsesSummary(negative, 0)).toContain("Budget négatif en janvier 2027");
  });

  it("starts at the reference month", () => {
    expect(incomeUsesSeries(months, 5)[0]!.month).toBe("2027-06");
    expect(incomeUsesSummary([], 0)).toBe("Aucune donnée.");
  });
});

describe("#91 gaps", () => {
  it("AC-01 — one entry per checked-in month, a gap for the months between", () => {
    const series = gapsSeries([
      comparison("2027-05", { incomeGap: 0, expensesGap: 5000 }),
      comparison("2027-03", { incomeGap: -2000, expensesGap: 0 }),
    ]);
    expect(series.map((p) => [p.month, p.incomeGap, p.expensesGap])).toEqual([
      ["2027-03", -20, 0],
      ["2027-04", null, null],
      ["2027-05", 0, 50],
    ]);
  });

  it("AC-02 — the ±10 € tolerance is inclusive", () => {
    expect(gapTone("expensesGap", 10)).toBe("good");
    expect(gapTone("expensesGap", 10.01)).toBe("bad");
    expect(gapTone("incomeGap", -10)).toBe("good");
    expect(gapTone("incomeGap", -10.01)).toBe("bad");
    expect(gapTone("incomeGap", null)).toBeNull();
  });

  it("keeps the 12 latest check-ins and skips those without totals", () => {
    const many = Array.from({ length: 14 }, (_, i) => comparison(`2027-${String(i + 1).padStart(2, "0")}`.replace("2027-13", "2028-01").replace("2027-14", "2028-02"), { incomeGap: 0, expensesGap: 0 }));
    expect(gapsSeries(many)[0]!.month).toBe("2027-03");
    expect(gapsSeries([comparison("2027-01")])).toEqual([]);
  });

  it("AC-03 — no check-in: empty series and summary", () => {
    expect(gapsSeries([])).toEqual([]);
    expect(gapsSummary([])).toBe("Aucun mois de suivi détaillé.");
  });

  it("summarises the latest month and the months out of tolerance", () => {
    const text = gapsSummary([comparison("2027-03", { incomeGap: -2000, expensesGap: 0 }), comparison("2027-04", { incomeGap: 0, expensesGap: 1001 })]);
    expect(text).toMatch(/Dernier mois, avril 2027 : revenus 0,00\s€, dépenses \+10,01\s€\. 2 mois au-delà/);
  });
});

describe("#92 spending", () => {
  const row = (label: string, planned: number, actual: number, extra: Partial<ActualLine> = {}): ActualLine => ({
    kind: "line",
    direction: "expense",
    category: "variable",
    budgetLineId: label,
    exceptionId: null,
    label,
    planned,
    actual,
    ...extra,
  });
  const actual = (month: string, lines: ActualLine[]): MonthlyActual =>
    ({ id: month, month, income: null, expenses: null, lines, emergencySavings: 0, freeSavings: 0 }) as unknown as MonthlyActual;

  it("AC-01 / AC-02 — expense rows of the latest month, largest overspend first", () => {
    const spending = latestSpending([
      actual("2027-04", [row("Courses", 40000, 47000), row("Loyer", 90000, 90000), row("Sorties", 10000, 5000), row("Salaire", 250000, 250000, { direction: "income" })]),
      actual("2027-02", [row("Ancien", 100, 900)]),
    ])!;
    expect(spending.month).toBe("2027-04");
    expect(spending.rows.map((r) => [r.label, r.planned, r.actual, r.gap])).toEqual([
      ["Courses", 400, 470, 70],
      ["Loyer", 900, 900, 0],
      ["Sorties", 100, 50, -50],
    ]);
    expect(spendingSummary(spending)).toMatch(/Plus gros dépassement : Courses, \+70,00\s€/);
  });

  it("AC-03 — rows keep their saved label once the budget line is deleted; empty rows are skipped", () => {
    const spending = latestSpending([actual("2027-04", [row("Abonnement", 2000, 2500, { budgetLineId: null }), row("Rien", 0, 0)])])!;
    expect(spending.rows.map((r) => r.label)).toEqual(["Abonnement"]);
  });

  it("a check-in without detail, and no check-in at all", () => {
    const spending = latestSpending([actual("2027-04", [])])!;
    expect(spending.detailed).toBe(false);
    expect(spendingSummary(spending)).toBe("Dépenses de avril 2027 non détaillées.");
    expect(latestSpending([])).toBeNull();
  });
});
