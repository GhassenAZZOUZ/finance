/**
 * Template import (issue #8) against the local database: importing the same file twice leaves the
 * same lines and loans, check-ins are kept, and the rows are the current user's. Requires `supabase start`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { planImport } from "@/lib/import/apply";
import { type TemplateData, readTemplateFile } from "@/lib/import/template";
import { anonClient, createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let user: TestUser;
let other: TestUser;
let repo: SupabaseFinanceRepository;
let data: TemplateData;

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser("import"), createTestUser("import-other")]);
  repo = new SupabaseFinanceRepository(user.client);
  const bytes = new Uint8Array(readFileSync("docs/plan_financier.template.xlsx"));
  const result = await readTemplateFile({ name: "plan_financier.xlsx", size: bytes.length, arrayBuffer: async () => bytes.buffer as ArrayBuffer });
  if (!result.ok) throw new Error(JSON.stringify(result));
  data = result.data;
});
afterAll(async () => {
  await Promise.all([deleteTestUser(user), deleteTestUser(other)]);
});

const importOnce = async () => repo.applyImport(planImport(await repo.load(), data));

describe("template import", () => {
  it("replaces the onboarding defaults with the template", async () => {
    await importOnce();
    const snap = await repo.load();
    expect(snap.settings).toMatchObject({ startMonth: "2027-01", freeSavingsExisting: 0 });
    // The spreadsheet's moving fund becomes the primary savings goal (SPEC D23).
    expect(snap.goals).toEqual([
      expect.objectContaining({ name: "Déménagement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000, priority: 1, primary: true }),
    ]);
    expect(snap.lines).toHaveLength(15);
    expect(snap.lines.find((l) => l.category === "income" && l.position === 0)?.amount).toBe(280000);
    expect(snap.loans.map((l) => l.name)).toEqual(["Prêt auto", "Carte revolving", "Prêt travaux", "Prêt étudiant", "Dette perso A", "Dette perso B"]);
  });

  it("is idempotent and keeps check-ins", async () => {
    const before = await repo.load();
    await repo.saveActual({
      month: "2027-01",
      income: null,
      expenses: null,
      emergencySavings: 0,
      freeSavings: 0,
      loanBalances: before.loans.map((l) => ({ loanId: l.id, balance: l.principal })),
      goalBalances: [],
      frozen: null,
    });
    await importOnce();
    const after = await repo.load();
    expect(after.lines.map((l) => l.id).sort()).toEqual(before.lines.map((l) => l.id).sort());
    expect(after.loans.map((l) => l.id)).toEqual(before.loans.map((l) => l.id));
    expect(after.archivedLoans).toEqual([]);
    expect(after.actuals).toHaveLength(1);
    expect(after.goals).toEqual(before.goals);
  });

  it("updates the primary goal's amounts and keeps its name and the other goals", async () => {
    const [primary] = (await repo.load()).goals;
    await repo.updateGoal(primary!.id, { name: "Appartement", target: 1000, deadlineMonth: "2030-01", alreadySaved: 0 });
    const car = await repo.createGoal({ name: "Voiture", target: 500000, deadlineMonth: "2029-01", alreadySaved: 0 }, 2);
    await importOnce();
    expect((await repo.load()).goals).toEqual([
      expect.objectContaining({ id: primary!.id, name: "Appartement", target: 400000, deadlineMonth: "2027-06", alreadySaved: 50000 }),
      car,
    ]);
  });

  it("writes nothing when a step fails part-way (all-or-nothing)", async () => {
    const before = await repo.load();
    const plan = planImport(before, data);
    // Budget and removals are valid; the last loan creation is refused by the database.
    const changed = { ...plan, lines: plan.lines.map((l) => ({ ...l, amount: l.amount + 100 })) };
    const bad = { ...changed, loanRemovals: [before.loans[0]!.id], loanCreates: [{ ...plan.loanUpdates[0]!.draft, principal: -1 }] };
    await expect(repo.applyImport(bad)).rejects.toMatchObject({ code: "23514" });
    expect(await repo.load()).toEqual(before);

    const missing = { ...changed, loanUpdates: [...plan.loanUpdates, { id: "00000000-0000-4000-8000-000000000000", draft: plan.loanUpdates[0]!.draft }] };
    await expect(repo.applyImport(missing)).rejects.toMatchObject({ code: "P0002" });
    expect(await repo.load()).toEqual(before);
  });

  it("is not callable without a session", async () => {
    const { error } = await anonClient().rpc("apply_import", {
      p_settings: {},
      p_lines: [],
      p_primary_goal: {},
      p_loan_removals: [],
      p_loan_updates: [],
      p_loan_creates: [],
    });
    expect(error?.code).toBe("42501");
  });

  it("writes nothing for another user", async () => {
    const snap = await new SupabaseFinanceRepository(other.client).load();
    expect(snap.settings).toBeNull();
    expect(snap.loans).toEqual([]);
  });
});
