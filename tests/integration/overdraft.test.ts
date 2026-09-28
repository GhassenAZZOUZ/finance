/**
 * Bank overdraft through the repository and the database rules (issue #28, SPEC D24).
 * Requires `supabase start`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseFinanceRepository } from "@/lib/data/supabase-repository";
import type { LoanDraft } from "@/lib/domain/types";
import { createTestUser, deleteTestUser, type TestUser } from "./supabase-env";

let a: TestUser;
let b: TestUser;
let repo: SupabaseFinanceRepository;

const overdraft: LoanDraft = {
  name: "Compte courant",
  type: "Découvert bancaire",
  principal: 80_000,
  principalPaidThroughMonth: null,
  apr: 0.16,
  monthlyPayment: 0,
  contractEndMonth: null,
  penaltyPct: null,
  penaltyCapMonths: null,
  kind: "overdraft",
  creditLimit: 100_000,
};

beforeAll(async () => {
  [a, b] = await Promise.all([createTestUser("od-a"), createTestUser("od-b")]);
  repo = new SupabaseFinanceRepository(a.client);
});
afterAll(async () => {
  await Promise.all([deleteTestUser(a), deleteTestUser(b)]);
});

describe("overdraft", () => {
  it("round-trips kind, limit, a 0 € repayment and a 0 € balance", async () => {
    const created = await repo.createLoan(overdraft);
    expect(created).toMatchObject({ kind: "overdraft", creditLimit: 100_000, monthlyPayment: 0 });
    await repo.updateLoan(created.id, { ...overdraft, principal: 0 });
    const [loan] = (await repo.load()).loans;
    expect(loan).toMatchObject({ kind: "overdraft", creditLimit: 100_000, principal: 0, monthlyPayment: 0 });
  });

  it("keeps the loan rules for ordinary loans and requires a limit for an overdraft", async () => {
    const bad = [
      a.client.from("loans").insert({ principal: 0, apr: 0.05, monthly_payment: 10 }),
      a.client.from("loans").insert({ principal: 100, apr: 0.05, monthly_payment: 0 }),
      a.client.from("loans").insert({ kind: "overdraft", principal: 100, apr: 0.1, monthly_payment: 0 }),
      a.client.from("loans").insert({ kind: "overdraft", credit_limit: 0, principal: 0, apr: 0.1, monthly_payment: 0 }),
      a.client.from("loans").insert({ kind: "overdraft", credit_limit: 500, principal: -1, apr: 0.1, monthly_payment: 0 }),
      a.client.from("loans").insert({ kind: "mortgage", principal: 100, apr: 0.1, monthly_payment: 10 }),
    ];
    const results = await Promise.all(bad);
    results.forEach((res, i) => expect(res.error, `insert #${i}`).not.toBeNull());
  });

  it("another user cannot read or change the overdraft's limit (RLS)", async () => {
    const [loan] = (await repo.load()).loans;
    const read = await b.client.from("loans").select("credit_limit").eq("id", loan!.id);
    expect(read.data).toEqual([]);
    const updated = await b.client.from("loans").update({ credit_limit: 1 }).eq("id", loan!.id).select();
    expect(updated.data).toEqual([]);
    expect((await repo.load()).loans[0]?.creditLimit).toBe(100_000);
  });
});
