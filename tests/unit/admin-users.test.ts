/** Back-office user list (issue #157, US-14): plan label, filters, sort, pages, CSV. */
import { describe, expect, it } from "vitest";
import { PAGE_SIZE, type UserRow, filterAndSort, page, parseListQuery, planLabel, toCsv, userRows } from "@/supabase/functions/admin/users";

const NOW = new Date("2027-03-15T12:00:00Z");
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();
const sub = (status: string, over: Partial<{ currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; pastDueSince: string | null; payingSince: string | null }> = {}) => ({
  status,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  payingSince: "2026-12-01T00:00:00Z",
  ...over,
});

describe("planLabel (paying > trial > offered > Free)", () => {
  it("labels each source, the paying one first", () => {
    expect(planLabel(sub("active"), { reason: "gift", expiresAt: null }, NOW)).toBe("Pro payant");
    expect(planLabel(sub("trialing"), { reason: "gift", expiresAt: null }, NOW)).toBe("Essai");
    expect(planLabel(null, { reason: "early_user", expiresAt: null }, NOW)).toBe("Pro offert");
    expect(planLabel(sub("canceled"), null, NOW)).toBe("Free");
  });

  it("counts past_due as paying during the grace period only; an expired grant is Free", () => {
    expect(planLabel(sub("past_due", { pastDueSince: iso(-2 * DAY) }), null, NOW)).toBe("Pro payant");
    expect(planLabel(sub("past_due", { pastDueSince: iso(-8 * DAY) }), null, NOW)).toBe("Free");
    // A trial ending with a declined card gets no grace period (#144).
    expect(planLabel(sub("past_due", { pastDueSince: iso(-1 * DAY), payingSince: null }), null, NOW)).toBe("Free");
    expect(planLabel(null, { reason: "gift", expiresAt: iso(-1000) }, NOW)).toBe("Free");
  });
});

const rows: UserRow[] = userRows(
  [
    { id: "a", email: "Alice@Example.test", createdAt: "2027-01-01T00:00:00Z", lastSignInAt: "2027-03-10T00:00:00Z" },
    { id: "b", email: "bob@example.test", createdAt: "2027-02-01T00:00:00Z", lastSignInAt: "2027-03-01T00:00:00Z" },
    { id: "c", email: "carole@other.test", createdAt: "2027-03-01T00:00:00Z", lastSignInAt: null },
  ],
  new Map([
    ["a", sub("active", { cancelAtPeriodEnd: true, currentPeriodEnd: "2027-04-01T00:00:00Z" })],
    ["b", sub("trialing")],
  ]),
  new Map([["c", { reason: "gift", expiresAt: null }]]),
  new Map([["a", { loans: 3, goals: 2 }]]),
  NOW,
);

describe("userRows", () => {
  it("joins account, subscription, grant and counts (zero without data)", () => {
    expect(rows[0]).toMatchObject({ userId: "a", plan: "Pro payant", status: "active", cancelAtPeriodEnd: true, loans: 3, goals: 2 });
    expect(rows[2]).toMatchObject({ userId: "c", plan: "Pro offert", status: null, loans: 0, goals: 0 });
  });
});

describe("parseListQuery / filterAndSort / page", () => {
  it("searches part of the e-mail ignoring case, newest sign-up first by default", () => {
    const q = parseListQuery({ search: "  EXAMPLE " });
    expect(filterAndSort(rows, q).map((r) => r.userId)).toEqual(["b", "a"]);
  });

  it("filters by plan and by status, « résiliation programmée » included", () => {
    expect(filterAndSort(rows, parseListQuery({ plan: "Pro offert" })).map((r) => r.userId)).toEqual(["c"]);
    expect(filterAndSort(rows, parseListQuery({ status: "trialing" })).map((r) => r.userId)).toEqual(["b"]);
    expect(filterAndSort(rows, parseListQuery({ status: "cancel_scheduled" })).map((r) => r.userId)).toEqual(["a"]);
  });

  it("sorts by last sign-in on request, never-signed-in last", () => {
    expect(filterAndSort(rows, parseListQuery({ sort: "last_sign_in" })).map((r) => r.userId)).toEqual(["a", "b", "c"]);
  });

  it("ignores unknown values", () => {
    expect(parseListQuery({ plan: "VIP", status: "deleted", sort: "money", page: -2 })).toEqual({ search: "", plan: null, status: null, sort: "created", page: 1 });
  });

  it("pages by 50", () => {
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => i);
    expect(page(many, 2)).toEqual({ rows: [50, 51, 52, 53, 54], total: 55, page: 2, pages: 2 });
    expect(page(many, 9).page).toBe(2);
    expect(page([], 1)).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
  });
});

describe("toCsv", () => {
  it("exports the list's columns with a BOM and ; separators, never a financial amount", () => {
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿email;inscription;derniere_connexion;plan;statut_abonnement;fin_de_periode;resiliation_programmee;credits;objectifs\r\n")).toBe(true);
    expect(csv).toContain("Alice@Example.test;2027-01-01T00:00:00Z;2027-03-10T00:00:00Z;Pro payant;active;2027-04-01T00:00:00Z;oui;3;2");
    expect(csv).toContain("carole@other.test;2027-03-01T00:00:00Z;;Pro offert;;;non;0;0");
  });

  it("neutralises spreadsheet formulas and quotes separators", () => {
    const csv = toCsv([{ ...rows[0]!, email: "=HYPERLINK(\"x\");evil" }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"");evil"`);
  });
});
