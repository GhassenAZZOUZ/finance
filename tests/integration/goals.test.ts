/**
 * Savings goals through SupabaseFinanceRepository (issue #10, SPEC D23): the moving fund is the
 * primary goal, extra goals round-trip, priorities swap, check-ins keep one balance per goal.
 * Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetSettings } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
  movingGoal: 400000,
  movingDeadlineMonth: "2027-06",
  movingAlreadySaved: 50000,
  emergencyTarget: 400000,
  emergencyExisting: 80000,
  freeSavingsExisting: 0,
  riskFreeRate: 0.024,
  earlyRepaymentPct: 0.6,
};

let user: TestUser;
let repo: SupabaseFinanceRepository;

beforeAll(async () => {
  user = await createTestUser("goals");
  repo = new SupabaseFinanceRepository(user.client);
});
afterAll(() => deleteTestUser(user));

describe("savings goals", () => {
  it("has no goal before the budget, then the moving fund as the primary goal", async () => {
    expect((await repo.load()).goals).toEqual([]);
    await repo.saveBudget(settings, [
      { category: "income", label: "Salaire", amount: 300000, position: 0, startMonth: null, endMonth: null },
    ]);
    expect((await repo.load()).goals).toEqual([
      { id: "moving", name: "Déménagement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000, priority: 1, primary: true },
    ]);
  });

  it("with the primary goal alone, the plan is exactly the moving-fund plan (AC-01)", async () => {
    const snapshot = await repo.load();
    const plan = computePlan(snapshot, "2027-01")!;
    const withoutGoals = computePlan({ ...snapshot, goals: [] }, "2027-01")!;
    expect(plan.input).toEqual(withoutGoals.input);
    expect(plan.result).toEqual(withoutGoals.result);
  });

  it("adds, updates, reorders and deletes extra goals", async () => {
    const car = await repo.createGoal({ name: " Voiture ", target: 800000, deadlineMonth: "2028-06", alreadySaved: 50000 }, 2);
    const trip = await repo.createGoal({ name: "Vacances", target: 150000, deadlineMonth: "2027-08", alreadySaved: 0 }, 3);
    await repo.updateGoal(car.id, { name: "Voiture", target: 900000, deadlineMonth: "2028-12", alreadySaved: 60000 });
    let goals = (await repo.load()).goals;
    expect(goals.map((g) => [g.name, g.priority, g.target])).toEqual([
      ["Déménagement", 1, 400000],
      ["Voiture", 2, 900000],
      ["Vacances", 3, 150000],
    ]);

    // Holidays first, then the move, then the car: the unique (user, priority) is deferred.
    await repo.orderGoals([trip.id, "moving", car.id]);
    goals = (await repo.load()).goals;
    expect(goals.map((g) => [g.name, g.priority])).toEqual([
      ["Vacances", 1],
      ["Déménagement", 2],
      ["Voiture", 3],
    ]);

    await repo.deleteGoal(trip.id);
    await expect(repo.deleteGoal("moving")).rejects.toMatchObject({ code: "forbidden" });
    await repo.orderGoals(["moving", car.id]);
    goals = (await repo.load()).goals;
    expect(goals.map((g) => [g.name, g.priority])).toEqual([
      ["Déménagement", 1],
      ["Voiture", 2],
    ]);
  });

  it("renames the primary goal and keeps its amounts in the settings", async () => {
    await repo.updateGoal("moving", { name: "Appartement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000 });
    const snap = await repo.load();
    expect(snap.goals[0]).toMatchObject({ id: "moving", name: "Appartement", primary: true });
    expect(snap.settings).toMatchObject({ movingGoal: 400000, movingDeadlineMonth: "2027-06" });
    // Saving the budget again does not reset the name or the priority.
    await repo.saveSettings(settings);
    expect((await repo.load()).goals[0]).toMatchObject({ name: "Appartement", priority: 1 });
  });

  it("stores one balance per extra goal with a check-in; deleting the goal drops them", async () => {
    const extra = await repo.createGoal({ name: "Moto", target: 300000, deadlineMonth: "2029-01", alreadySaved: 0 }, 3);
    const car = (await repo.load()).goals.find((g) => g.name === "Voiture")!;
    await repo.saveActual({
      month: "2027-01",
      income: null,
      expenses: null,
      movingSavings: 60000,
      emergencySavings: 80000,
      freeSavings: 0,
      loanBalances: [],
      goalBalances: [
        { goalId: car.id, balance: 70000 },
        { goalId: extra.id, balance: 1234 },
      ],
      frozen: null,
    });
    let actual = (await repo.load()).actuals[0]!;
    expect(actual.goalBalances.map((b) => [b.goalId, b.balance]).sort()).toEqual(
      [
        [car.id, 70000],
        [extra.id, 1234],
      ].sort(),
    );
    await repo.deleteGoal(extra.id);
    actual = (await repo.load()).actuals[0]!;
    expect(actual.goalBalances.map((b) => b.goalId)).toEqual([car.id]);
  });
});
