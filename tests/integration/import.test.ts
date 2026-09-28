/**
 * Template import (issue #8) against the local database: importing the same file twice leaves the
 * same lines and loans, check-ins are kept, and the rows are the current user's. Requires `supabase start`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { applyImport, planImport } from "@/lib/import/apply";
import { type TemplateData, readTemplateFile } from "@/lib/import/template";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

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

const importOnce = async () => applyImport(repo, planImport(await repo.load(), data));

describe("template import", () => {
  it("replaces the onboarding defaults with the template", async () => {
    await importOnce();
    const snap = await repo.load();
    expect(snap.settings).toMatchObject({ startMonth: "2027-01", movingGoal: 400000, freeSavingsExisting: 0 });
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
      movingSavings: 0,
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
  });

  it("writes nothing for another user", async () => {
    const snap = await new SupabaseFinanceRepository(other.client).load();
    expect(snap.settings).toBeNull();
    expect(snap.loans).toEqual([]);
  });
});
