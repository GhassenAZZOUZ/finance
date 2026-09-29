/** Redesigned dashboard helpers (docs/design/README.md §3 and §5), checked on the demo seed. */
import { describe, expect, it } from "vitest";
import {
  checkInStrip,
  dashboardHeadline,
  monthsGained,
  movingShortfallOptions,
  planPhases,
  roadmapEvents,
  roadmapWindow,
} from "@/app/(app)/_dashboard/logic";
import { type ActualComparison, type PlanInput, simulatePlan } from "@/lib/engine";
import { formatEuros, formatEurosWhole } from "@/lib/format";

/** supabase/seed.sql with the plan starting in July 2026 (deadline = start + 5 months). */
const DEMO: PlanInput = {
  budget: {
    income: 290_000,
    fixedCosts: 107_500,
    variableExpenses: 65_000,
    startMonth: "2026-07",
    movingGoal: 400_000,
    movingDeadlineMonth: "2026-12",
    movingAlreadySaved: 50_000,
    emergencyTarget: 400_000,
    emergencyExisting: 80_000,
    riskFreeRate: 0.024,
    earlyRepaymentPct: 0.6,
  },
  loans: [
    { id: "auto", name: "Prêt auto", principal: 820_000, apr: 0.049, monthlyPayment: 24_530 },
    { id: "revolving", name: "Carte revolving", principal: 185_000, apr: 0.189, monthlyPayment: 7_240 },
    { id: "works", name: "Prêt travaux", principal: 340_000, apr: 0.0615, monthlyPayment: 11_875 },
    { id: "student", name: "Prêt étudiant", principal: 210_000, apr: 0.012, monthlyPayment: 9_500 },
    { id: "a", name: "Dette perso A", principal: 60_000, apr: 0, monthlyPayment: 15_000 },
    { id: "b", name: "Dette perso B", principal: 25_000, apr: 0, monthlyPayment: 5_000 },
  ],
};
const RESULT = simulatePlan(DEMO);

describe("movingShortfallOptions", () => {
  it("matches the demo check: 488,70 € short, 4 months → 122,18 €/mois, deadline → janvier 2027", () => {
    const options = movingShortfallOptions(DEMO, RESULT, "2026-09");
    expect(options).toEqual({
      goal: 400_000,
      amountAtDeadline: 351_130,
      shortfall: 48_870,
      deadlineMonth: "2026-12",
      monthsLeft: 4,
      extraPerMonth: 12_218,
      deadlineThatWorks: "2027-01",
    });
  });

  it("is null when the goal is met", () => {
    const easy = { ...DEMO, budget: { ...DEMO.budget, movingGoal: 100_000 } };
    expect(movingShortfallOptions(easy, simulatePlan(easy), "2026-09")).toBeNull();
  });

  it("has no per-month amount once the deadline is past", () => {
    const options = movingShortfallOptions(DEMO, RESULT, "2027-02");
    expect(options?.monthsLeft).toBe(0);
    expect(options?.extraPerMonth).toBeNull();
  });
});

describe("dashboardHeadline / monthsGained", () => {
  it("states the debt-free month and the goals' status, with the goal's own name (SPEC D23)", () => {
    expect(dashboardHeadline(RESULT.kpis)).toBe("Plus de dettes en juin 2028. « Déménagement » demande un ajustement.");
    const two = simulatePlan({
      ...DEMO,
      budget: {
        ...DEMO.budget,
        goals: [
          { id: "moving", name: "Voyage", target: 400_000, deadlineMonth: "2026-12", alreadySaved: 50_000 },
          { id: "car", name: "Voiture", target: 100_000, deadlineMonth: "2027-12", alreadySaved: 0 },
        ],
      },
    });
    expect(dashboardHeadline(two.kpis)).toMatch(/ Les objectifs d’épargne (sont financés|demandent un ajustement)\.$/);
  });

  it("counts the months gained on the debt-free date", () => {
    expect(RESULT.kpis.debtFreeMonth).toBe("2028-06");
    expect(monthsGained(RESULT)).toBe(13);
  });
});

describe("planPhases", () => {
  it("cuts the demo plan into moving → emergency → repay → free", () => {
    const phases = planPhases(RESULT.months).map((p) => [p.kind, p.startMonth, p.endMonth]);
    expect(phases).toEqual([
      ["moving", "2026-07", "2026-12"],
      ["emergency", "2027-01", "2027-05"],
      ["repay", "2027-06", "2028-06"],
      ["free", "2028-07", "2051-06"],
    ]);
  });
});

describe("roadmapEvents", () => {
  it("lists payoffs, the deadline, the emergency fund and the debt-free month in order", () => {
    const events = roadmapEvents(DEMO, RESULT);
    expect(events.map((e) => [e.kind, e.month, e.text])).toEqual([
      ["loanPaidOff", "2026-10", "Dette perso A soldé"],
      ["loanPaidOff", "2026-11", "Dette perso B soldé"],
      ["deadline", "2026-12", `Déménagement : ${formatEuros(351_130)} sur ${formatEurosWhole(400_000)}`],
      ["emergencyReached", "2027-05", `Fonds d’urgence complet (${formatEurosWhole(400_000)})`],
      ["loanPaidOff", "2027-08", "Carte revolving soldé"],
      ["loanPaidOff", "2027-12", "Prêt travaux soldé"],
      ["loanPaidOff", "2028-05", "Prêt étudiant soldé"],
      ["debtFree", "2028-06", "Prêt auto soldé · plus de dettes"],
      ["freeSavings", "2028-07", `${formatEurosWhole(117_500)} / mois en épargne libre`],
    ]);
    expect(roadmapWindow(events, 3, RESULT.months.length)).toBe(30);
  });
});

describe("checkInStrip", () => {
  const july = { month: "2026-07", status: "onTrack" } as ActualComparison;

  it("shows the last three open months, oldest first", () => {
    expect(checkInStrip("2026-07", "2026-09", [july]).map((s) => [s.month, s.state])).toEqual([
      ["2026-07", "entered"],
      ["2026-08", "pending"],
      ["2026-09", "current"],
    ]);
  });

  it("is shorter at the start of the plan and empty before it", () => {
    expect(checkInStrip("2026-09", "2026-09", []).map((s) => s.state)).toEqual(["current"]);
    expect(checkInStrip("2026-10", "2026-09", [])).toEqual([]);
  });
});
