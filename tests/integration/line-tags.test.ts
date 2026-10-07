/** Tags on budget lines (issue #145): Pro only, kept when the budget is saved. Requires `supabase start`. */
import { afterEach, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

const users: TestUser[] = [];
afterEach(async () => {
  await Promise.all(users.splice(0).map(deleteTestUser));
});

async function firstLine(u: TestUser) {
  const { data } = await u.client.from("budget_lines").select("id").order("position").limit(1).single<{ id: string }>();
  return data!.id;
}

describe("budget line tags", () => {
  it("are refused for a Free account with PT402 « tags_limit »", async () => {
    const u = await createTestUser("tags-free", { plan: "free" });
    users.push(u);
    const repo = new SupabaseFinanceRepository(u.client);
    await expect(repo.setLineTag(await firstLine(u), "Logement")).rejects.toMatchObject({ code: "PT402", message: "tags_limit" });
  });

  it("are saved for Pro, cleared with null, and kept when the budget is saved", async () => {
    const u = await createTestUser("tags-pro");
    users.push(u);
    const repo = new SupabaseFinanceRepository(u.client);
    const id = await firstLine(u);
    await repo.setLineTag(id, "  Logement ");
    let snapshot = await repo.load();
    expect(snapshot.lines.find((l) => l.id === id)?.tag).toBe("Logement");

    // save_budget lists its columns: the tag survives a budget save.
    await repo.saveBudget(
      { startMonth: "2027-01", emergencyTarget: 0, emergencyExisting: 0, freeSavingsExisting: 0, riskFreeRate: 0.03, earlyRepaymentPct: 0.5 },
      snapshot.lines.map((l) => ({ id: l.id, category: l.category, label: l.label, amount: l.amount, position: l.position, startMonth: null, endMonth: null })),
    );
    snapshot = await repo.load();
    expect(snapshot.lines.find((l) => l.id === id)?.tag).toBe("Logement");

    await repo.setLineTag(id, null);
    expect((await repo.load()).lines.find((l) => l.id === id)?.tag).toBeUndefined();
  });
});
