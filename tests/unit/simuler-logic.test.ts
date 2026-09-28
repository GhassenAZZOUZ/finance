/** "Et si…" simulator view-model (issue #2, SPEC D17). */
import { describe, expect, it } from "vitest";
import {
  type ExtraRow,
  type SimulationBase,
  type SimulationForm,
  type SimulationState,
  chartMonthCount,
  compareScenarios,
  firstNegativeFreeSavings,
  initialSimulation,
  monthDifference,
  moneyDifference,
  scenarioInput,
  scenarioSeries,
  simulationBase,
  updateSimulation,
} from "@/app/(app)/simuler/logic";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetLine, FinanceSnapshot, Loan } from "@/lib/domain/types";
import { simulatePlan } from "@/lib/engine";

const line = (id: string, category: BudgetLine["category"], label: string, amount: number): BudgetLine => ({
  id,
  category,
  label,
  amount,
  position: 0,
  startMonth: null,
  endMonth: null,
});

const loan = (id: string, name: string, principal: number, apr: number, monthlyPayment: number): Loan => ({
  id,
  name,
  type: null,
  principal,
  principalPaidThroughMonth: null,
  apr,
  monthlyPayment,
  contractEndMonth: null, penaltyPct: null, penaltyCapMonths: null,
  position: 0,
  archivedAt: null,
});

const SNAPSHOT: FinanceSnapshot = {
  settings: {
    startMonth: "2027-01",
    movingGoal: 300_000,
    movingDeadlineMonth: "2027-12",
    movingAlreadySaved: 0,
    emergencyTarget: 600_000,
    emergencyExisting: 100_000,
    freeSavingsExisting: 0,
    riskFreeRate: 0.03,
    earlyRepaymentPct: 0.5,
  },
  lines: [line("salary", "income", "Salaire", 300_000), line("rent", "fixed", "Loyer", 120_000), line("food", "variable", "Courses", 40_000)],
  exceptions: [],
  loans: [loan("auto", "Prêt auto", 500_000, 0.06, 20_000), loan("perso", "Prêt perso", 300_000, 0.04, 15_000)],
  archivedLoans: [],
  actuals: [],
};
const CURRENT = "2027-01";
const BASE = simulationBase(SNAPSHOT, CURRENT) as SimulationBase;

const results = (state: SimulationState) => ({
  current: simulatePlan(scenarioInput(BASE, initialSimulation(BASE).scenario)),
  simulated: simulatePlan(scenarioInput(BASE, state.scenario)),
});

const edit = (state: SimulationState, patch: Partial<SimulationForm>) => updateSimulation(state, { ...state.form, ...patch }, BASE);

const row = (overrides: Partial<ExtraRow> = {}): ExtraRow => ({
  key: "x1",
  loanId: "auto",
  month: "2027-03",
  amount: "2000",
  source: "external",
  ...overrides,
});

describe("initialSimulation (AC-01)", () => {
  it("is pre-filled with the saved values", () => {
    const state = initialSimulation(BASE);
    expect(state.form).toEqual({
      earlyRepaymentPct: "50",
      riskFreeRate: "3",
      lineAmounts: { salary: "3000,00", rent: "1200,00", food: "400,00" },
      extras: [],
    });
    expect(state.errors).toEqual({});
  });

  it("simulates exactly the saved plan: every difference is 'Identique'", () => {
    const { current, simulated } = results(initialSimulation(BASE));
    expect(simulated).toEqual(computePlan(SNAPSHOT, CURRENT)!.result);
    expect(compareScenarios(current.kpis, simulated.kpis).map((r) => r.difference)).toEqual(Array(5).fill("Identique"));
  });

  it("needs saved budget settings", () => {
    expect(simulationBase({ ...SNAPSHOT, settings: null }, CURRENT)).toBeNull();
  });
});

describe("updateSimulation", () => {
  it("AC-02: a higher early-repayment % repays sooner and saves more interest", () => {
    const state = edit(initialSimulation(BASE), { earlyRepaymentPct: "80" });
    expect(state.errors).toEqual({});
    expect(state.scenario.earlyRepaymentPct).toBe(0.8);
    const { current, simulated } = results(state);
    expect(simulated.kpis.interestSaved).toBeGreaterThan(current.kpis.interestSaved);
    const [debtFree] = compareScenarios(current.kpis, simulated.kpis);
    expect(debtFree?.difference).toMatch(/^\d+ mois plus tôt$/);
    expect(debtFree?.tone).toBe("good");
  });

  it("AC-07: an invalid value shows a French error and keeps the last valid value", () => {
    const valid = edit(initialSimulation(BASE), { earlyRepaymentPct: "80" });
    const invalid = edit(valid, { earlyRepaymentPct: "150" });
    expect(invalid.errors.earlyRepaymentPct).toBe("Le taux doit être inférieur ou égal à 100 %");
    expect(invalid.scenario).toEqual(valid.scenario);
    expect(invalid.form.earlyRepaymentPct).toBe("150");
    expect(edit(invalid, { riskFreeRate: "abc" }).errors).toEqual({
      earlyRepaymentPct: "Le taux doit être inférieur ou égal à 100 %",
      riskFreeRate: "Taux invalide",
    });
  });

  it("AC-09: a lower budget line raises the free savings at 12 months, only in the simulation", () => {
    const state = edit(initialSimulation(BASE), { lineAmounts: { ...initialSimulation(BASE).form.lineAmounts, food: "300" } });
    expect(state.scenario.lineAmounts.food).toBe(30_000);
    const { current, simulated } = results(state);
    expect(simulated.kpis.freeSavingsAt12).toBeGreaterThan(current.kpis.freeSavingsAt12);
    expect(BASE.lines.find((l) => l.id === "food")?.amount).toBe(40_000);
  });

  it("AC-03: an extra repayment lowers that loan's balance that month by its amount", () => {
    const state = edit(initialSimulation(BASE), { extras: [row()] });
    expect(state.errors).toEqual({});
    expect(state.scenario.extras).toEqual([{ key: "x1", loanId: "auto", month: "2027-03", amount: 200_000, source: "external" }]);
    const { current, simulated } = results(state);
    expect(simulated.months[2]!.loans[0]!.endBalance).toBe(current.months[2]!.loans[0]!.endBalance - 200_000);
  });

  it.each([
    [{ amount: "-5" }, "amount", "Le montant ne peut pas être négatif"],
    [{ amount: "0" }, "amount", "Le montant doit être supérieur à 0"],
    [{ amount: "" }, "amount", "Montant requis"],
    [{ month: "" }, "month", "Mois requis"],
    [{ month: "2026-12" }, "month", "Mois hors du plan (de janvier 2027 à décembre 2051)"],
    [{ loanId: "" }, "loanId", "Choisissez un crédit"],
  ])("AC-07: rejects an extra repayment with %o", (overrides, field, message) => {
    const state = edit(initialSimulation(BASE), { extras: [row(overrides)] });
    expect(state.errors[`extra.x1.${field}`]).toBe(message);
    expect(state.scenario.extras).toEqual([]);
  });

  it("AC-07: refuses more than the loan's balance that month, keeping the last valid amount", () => {
    const { current } = results(initialSimulation(BASE));
    const open = current.months[2]!.loans[0]!.balanceAfterPayment;
    const valid = edit(initialSimulation(BASE), { extras: [row()] });
    const tooMuch = edit(valid, { extras: [row({ amount: String((open + 1) / 100) })] });
    expect(tooMuch.errors["extra.x1.amount"]).toMatch(/^Dépasse le solde restant en mars 2027 : .+ maximum$/);
    expect(tooMuch.scenario.extras).toEqual(valid.scenario.extras);
    // The whole balance is accepted: the loan closes that month.
    const all = edit(valid, { extras: [row({ amount: String(open / 100) })] });
    expect(all.errors).toEqual({});
    expect(results(all).simulated.months[2]!.loans[0]!.endBalance).toBe(0);
  });

  it("refuses an extra repayment on a loan already repaid in the simulation", () => {
    const closes = results(initialSimulation(BASE)).current.months[2]!.loans[0]!.balanceAfterPayment;
    const state = edit(initialSimulation(BASE), {
      extras: [row({ amount: String(closes / 100) }), row({ key: "x2", month: "2027-05", amount: "10" })],
    });
    expect(state.errors["extra.x2.amount"]).toBe("Ce crédit est déjà remboursé en mai 2027 dans la simulation");
    expect(state.scenario.extras.map((e) => e.key)).toEqual(["x1"]);
  });

  it("removing a row removes it from the scenario", () => {
    const state = edit(edit(initialSimulation(BASE), { extras: [row()] }), { extras: [] });
    expect(state.scenario.extras).toEqual([]);
  });
});

describe("free savings used for an extra repayment", () => {
  it("flags the first month the simulated free savings go negative", () => {
    const state = edit(initialSimulation(BASE), { extras: [row({ source: "freeSavings" })] });
    const { current, simulated } = results(state);
    expect(firstNegativeFreeSavings(current)).toBeNull();
    expect(firstNegativeFreeSavings(simulated)).toBe("2027-03");
  });
});

describe("differences", () => {
  it("months: earlier is good, later is bad", () => {
    expect(monthDifference("2030-01", "2029-10")).toEqual({ text: "3 mois plus tôt", tone: "good" });
    expect(monthDifference("2030-01", "2030-02")).toEqual({ text: "1 mois plus tard", tone: "bad" });
    expect(monthDifference("2030-01", "2030-01")).toEqual({ text: "Identique", tone: null });
    expect(monthDifference(null, "2030-01")).toEqual({ text: "Atteint dans la simulation", tone: "good" });
    expect(monthDifference("2030-01", null)).toEqual({ text: "Plus atteint dans la simulation", tone: "bad" });
    expect(monthDifference(null, null)).toEqual({ text: "Identique", tone: null });
  });

  it("money: signed, higher is good by default", () => {
    expect(moneyDifference(10_000, 12_500).tone).toBe("good");
    expect(moneyDifference(10_000, 12_500).text.replace(/\s/g, " ")).toBe("+25,00 €");
    expect(moneyDifference(10_000, 9_000).tone).toBe("bad");
    expect(moneyDifference(10_000, 9_000, false).tone).toBe("good");
    expect(moneyDifference(10_000, 10_000)).toEqual({ text: "Identique", tone: null });
  });
});

describe("charts (AC-08)", () => {
  it("cover both scenarios until both are debt-free, at least 24 months", () => {
    const { current, simulated } = results(edit(initialSimulation(BASE), { earlyRepaymentPct: "0" }));
    const count = chartMonthCount(current, simulated);
    const slowest = simulated.months.findIndex((m) => m.month === simulated.kpis.debtFreeMonth) + 1;
    expect(count).toBe(Math.max(24, slowest + 3));
    const points = scenarioSeries(current, simulated, count);
    expect(points).toHaveLength(count);
    expect(points[0]).toEqual({
      month: "2027-01",
      label: expect.any(String),
      currentDebt: current.months[0]!.remainingDebt / 100,
      simulatedDebt: simulated.months[0]!.remainingDebt / 100,
      currentFreeSavings: current.months[0]!.freeSavingsCumulative / 100,
      simulatedFreeSavings: simulated.months[0]!.freeSavingsCumulative / 100,
    });
  });
});
