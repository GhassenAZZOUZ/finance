/**
 * Savings goals through SupabaseFinanceRepository (issue #10, SPEC D23, tech-debt 6): every goal is a
 * savings_goals row, the first one is the primary goal (the moving fund), priorities swap, check-ins
 * keep one balance per goal, and the primary goal is deleted only by handing the flag over.
 * Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { computePlan } from "@/lib/domain/plan";
import type { BudgetSettings } from "@/lib/domain/types";
import { anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const settings: BudgetSettings = {
  startMonth: "2027-01",
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

const names = async () => (await repo.load()).goals.map((g) => [g.name, g.priority, g.primary]);

describe("savings goals", () => {
  it("has no goal with the budget alone; the first goal added is the primary one", async () => {
    await repo.saveBudget(settings, [
      { category: "income", label: "Salaire", amount: 300000, position: 0, startMonth: null, endMonth: null },
    ]);
    expect((await repo.load()).goals).toEqual([]);
    const moving = await repo.createGoal({ name: "Déménagement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000 }, 1);
    expect(moving).toMatchObject({ name: "Déménagement", target: 400000, alreadySaved: 50000, priority: 1, primary: true });
    expect((await repo.load()).goals).toEqual([moving]);
  });

  it("with the primary goal alone, the engine gets the spreadsheet's single moving fund (AC-01)", async () => {
    const plan = computePlan(await repo.load(), "2027-01")!;
    expect(plan.input.budget).toMatchObject({ movingGoal: 400000, movingDeadlineMonth: "2027-06", movingAlreadySaved: 50000 });
    expect(plan.input.budget.goals).toBeUndefined();
  });

  it("adds, updates and reorders goals, the primary one included", async () => {
    const [moving] = (await repo.load()).goals;
    const car = await repo.createGoal({ name: " Voiture ", target: 800000, deadlineMonth: "2028-06", alreadySaved: 50000 }, 2);
    const trip = await repo.createGoal({ name: "Vacances", target: 150000, deadlineMonth: "2027-08", alreadySaved: 0 }, 3);
    expect(car.primary).toBe(false);
    await repo.updateGoal(car.id, { name: "Voiture", target: 900000, deadlineMonth: "2028-12", alreadySaved: 60000, rate: 0.024 });
    // The primary goal's amounts are edited like any goal's.
    await repo.updateGoal(moving!.id, { name: "Appartement", target: 450000, deadlineMonth: "2027-09", alreadySaved: 70000 });
    expect((await repo.load()).goals.map((g) => [g.name, g.priority, g.target])).toEqual([
      ["Appartement", 1, 450000],
      ["Voiture", 2, 900000],
      ["Vacances", 3, 150000],
    ]);

    // The yearly interest rate (SPEC D28) survives the round-trip and the reordering.
    expect((await repo.load()).goals.find((g) => g.id === car.id)?.rate).toBe(0.024);

    // Holidays first, then the flat, then the car: the unique (user, priority) is deferred.
    await repo.orderGoals([trip.id, moving!.id, car.id]);
    expect(await names()).toEqual([
      ["Vacances", 1, false],
      ["Appartement", 2, true],
      ["Voiture", 3, false],
    ]);
    // Saving the budget again leaves the goals alone.
    await repo.saveSettings(settings);
    expect((await repo.load()).goals).toHaveLength(3);
    expect((await repo.load()).goals.find((g) => g.id === car.id)?.rate).toBe(0.024);
  });

  it("deletes a goal and closes the priority gap", async () => {
    const trip = (await repo.load()).goals.find((g) => g.name === "Vacances")!;
    await repo.deleteGoal(trip.id);
    expect(await names()).toEqual([
      ["Appartement", 1, true],
      ["Voiture", 2, false],
    ]);
  });

  it("stores one balance per goal, the primary one included; deleting a goal drops its balances", async () => {
    const [moving, car] = (await repo.load()).goals;
    const extra = await repo.createGoal({ name: "Moto", target: 300000, deadlineMonth: "2029-01", alreadySaved: 0 }, 3);
    await repo.saveActual({
      month: "2027-01",
      income: null,
      expenses: null,
      emergencySavings: 80000,
      freeSavings: 0,
      loanBalances: [],
      goalBalances: [
        { goalId: moving!.id, balance: 60000 },
        { goalId: car!.id, balance: 70000 },
        { goalId: extra.id, balance: 1234 },
      ],
      frozen: null,
    });
    const balances = async () => new Map((await repo.load()).actuals[0]!.goalBalances.map((b) => [b.goalId, b.balance]));
    expect(await balances()).toEqual(
      new Map([
        [moving!.id, 60000],
        [car!.id, 70000],
        [extra.id, 1234],
      ]),
    );
    await repo.deleteGoal(extra.id);
    expect([...(await balances()).keys()].sort()).toEqual([moving!.id, car!.id].sort());
  });

  it("deletes the primary goal only by naming the goal that replaces it", async () => {
    const [moving, car] = (await repo.load()).goals;
    await expect(repo.deleteGoal(moving!.id)).rejects.toMatchObject({ code: "22023" });
    await expect(repo.deleteGoal(moving!.id, moving!.id)).rejects.toMatchObject({ code: "22023" });
    expect(await names()).toEqual([
      ["Appartement", 1, true],
      ["Voiture", 2, false],
    ]);

    await repo.deleteGoal(moving!.id, car!.id);
    expect(await names()).toEqual([["Voiture", 1, true]]);
  });

  it("keeps the rules in the database: one primary goal, a target for the others", async () => {
    const [car] = (await repo.load()).goals;
    const bike = await repo.createGoal({ name: "Vélo", target: 50000, deadlineMonth: "2028-01", alreadySaved: 0 }, 2);
    const second = await user.client.from("savings_goals").update({ is_primary: true }).eq("id", bike.id);
    expect(second.error?.code).toBe("23505");
    const noTarget = await user.client.from("savings_goals").update({ target: 0 }).eq("id", bike.id);
    expect(noTarget.error?.code).toBe("23514");
    // Losing the primary flag without a successor is refused at commit.
    const orphan = await user.client.from("savings_goals").update({ is_primary: false }).eq("id", car!.id);
    expect(orphan.error?.code).toBe("P0003");
    // The primary goal may have no target yet.
    await repo.updateGoal(car!.id, { name: "Voiture", target: 0, deadlineMonth: "2028-12", alreadySaved: 0 });
    await repo.deleteGoal(bike.id);
  });

  it("delete_goal is not callable without a session", async () => {
    const { error } = await anonClient().rpc("delete_goal", { p_id: "00000000-0000-4000-8000-000000000000" });
    expect(error?.code).toBe("42501");
  });

  it("the last goal can be deleted: no goal, no primary", async () => {
    const [last] = (await repo.load()).goals;
    await repo.deleteGoal(last!.id);
    expect((await repo.load()).goals).toEqual([]);
    const plan = computePlan(await repo.load(), "2027-01")!;
    expect(plan.input.budget).toMatchObject({ movingGoal: 0, movingAlreadySaved: 0 });
  });
});
