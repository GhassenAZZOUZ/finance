/** Admin dashboard figures (issue #160, US-17; definitions SPEC D37). Invented data only. */
import { describe, expect, it } from "vitest";
import { type DashboardAccount, dashboardFigures, monthOf } from "@/supabase/functions/admin/dashboard";
import { planLabel } from "@/supabase/functions/admin/users";

const NOW = new Date("2027-03-15T12:00:00Z");
const account = (over: Partial<DashboardAccount> = {}): DashboardAccount => ({
  createdAt: "2026-06-01T10:00:00Z",
  lastSignInAt: null,
  plan: "Free",
  status: null,
  priceId: null,
  payingSince: null,
  endedAt: null,
  ...over,
});

describe("monthOf", () => {
  it("uses the Europe/Paris month", () => {
    expect(monthOf("2027-02-28T22:30:00Z")).toBe("2027-02");
    // 23:30 UTC on 28 February is already 1 March in Paris.
    expect(monthOf("2027-02-28T23:30:00Z")).toBe("2027-03");
    expect(monthOf("2026-12-31T23:30:00Z")).toBe("2027-01");
  });
});

describe("dashboardFigures", () => {
  it("counts the totals by plan, offered Pro apart (AC-01)", () => {
    const accounts = [
      ...Array.from({ length: 3 }, () => account({ plan: "Pro payant", status: "active" })),
      ...Array.from({ length: 2 }, () => account({ plan: "Essai", status: "trialing" })),
      account({ plan: "Pro offert" }),
      ...Array.from({ length: 4 }, () => account()),
    ];
    expect(dashboardFigures(accounts, null, NOW)).toMatchObject({ users: 10, paying: 3, trials: 2, offered: 1, inGrace: 0 });
  });

  it("counts past_due in grace as paying and in grace, not past the grace (AC-03, same labels as the list)", () => {
    const label = (since: string) => planLabel({ status: "past_due", currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: since, payingSince: "2027-01-01T00:00:00Z" }, null, NOW);
    const accounts = [
      account({ plan: label("2027-03-12T00:00:00Z"), status: "past_due" }),
      account({ plan: label("2027-03-14T00:00:00Z"), status: "past_due" }),
      account({ plan: label("2027-03-01T00:00:00Z"), status: "past_due" }),
    ];
    expect(dashboardFigures(accounts, null, NOW)).toMatchObject({ paying: 2, inGrace: 2 });
  });

  it("counts active users over the last 30 days", () => {
    const accounts = [account({ lastSignInAt: "2027-03-01T00:00:00Z" }), account({ lastSignInAt: "2027-02-13T11:00:00Z" }), account()];
    expect(dashboardFigures(accounts, null, NOW).activeLast30Days).toBe(1);
  });

  it("counts the month's events in Paris time, this month and the previous one only (AC-02)", () => {
    const accounts = [
      account({ createdAt: "2027-03-02T09:00:00Z" }),
      // 1 March in Paris.
      account({ createdAt: "2027-02-28T23:30:00Z" }),
      account({ createdAt: "2027-02-10T09:00:00Z" }),
      // Two months ago: not counted.
      account({ createdAt: "2027-01-20T09:00:00Z" }),
      account({ plan: "Pro payant", status: "active", payingSince: "2027-03-05T00:00:00Z" }),
      account({ plan: "Pro payant", status: "active", payingSince: "2027-02-05T00:00:00Z" }),
      account({ status: "canceled", payingSince: "2026-11-05T00:00:00Z", endedAt: "2027-03-01T00:00:00Z" }),
      account({ status: "canceled", payingSince: "2026-11-05T00:00:00Z", endedAt: "2027-02-01T00:00:00Z" }),
      // A trial that ends without paying is not a cancellation; a trial is not a new subscription.
      account({ status: "canceled", payingSince: null, endedAt: "2027-03-03T00:00:00Z" }),
      account({ plan: "Essai", status: "trialing", createdAt: "2027-01-01T00:00:00Z" }),
    ];
    const f = dashboardFigures(accounts, null, NOW);
    expect(f.current).toEqual({ month: "2027-03", signups: 2, newSubscriptions: 1, cancellations: 1 });
    expect(f.previous).toEqual({ month: "2027-02", signups: 1, newSubscriptions: 1, cancellations: 1 });
  });

  it("goes back to December in January", () => {
    expect(dashboardFigures([], null, new Date("2027-01-10T12:00:00Z")).previous.month).toBe("2026-12");
  });

  it("estimates the MRR in cents: monthly price, or yearly / 12; never offered Pro nor trials (AC-11)", () => {
    const accounts = [
      account({ plan: "Pro payant", status: "active", priceId: "price_M" }),
      account({ plan: "Pro payant", status: "active", priceId: "price_Y" }),
      account({ plan: "Pro payant", status: "past_due", priceId: "price_Y" }),
      account({ plan: "Essai", status: "trialing", priceId: "price_M" }),
      account({ plan: "Pro offert" }),
    ];
    expect(dashboardFigures(accounts, "price_Y", NOW).mrrCents).toBe(499 + 325 + 325);
  });

  it("shows zeros on an empty base and returns only named counts (AC-05, AC-09)", () => {
    expect(dashboardFigures([], null, NOW)).toEqual({
      users: 0,
      activeLast30Days: 0,
      paying: 0,
      trials: 0,
      offered: 0,
      inGrace: 0,
      mrrCents: 0,
      current: { month: "2027-03", signups: 0, newSubscriptions: 0, cancellations: 0 },
      previous: { month: "2027-02", signups: 0, newSubscriptions: 0, cancellations: 0 },
    });
  });
});
