/**
 * Admin dashboard figures (issue #160, US-17). The definitions are written once in SPEC D37 and
 * shared with the resale metrics (US-10, #147). Owner decisions 2026-10-07: past_due within the grace
 * period counts as paying; a trial is not a subscription, its switch to paid is; a cancellation is
 * dated at the end of access; months in Europe/Paris; offered Pro (admins and test accounts included)
 * counted apart, never as paying nor in the MRR; MRR estimated from our tables (monthly price, or
 * yearly ÷ 12), the exact figure stays in Stripe. Counts only: no e-mail, id or amount of a user.
 * Pure: the plan labels come from users.ts, so the figures agree with the user list (AC-08).
 */

/** Prices in cents (docs/BILLING.md); what Stripe charges is the price of each plan. */
export const MONTHLY_CENTS = 499;
export const YEARLY_CENTS = 3900;

export interface DashboardAccount {
  createdAt: string;
  lastSignInAt: string | null;
  plan: "Pro payant" | "Essai" | "Pro offert" | "Free";
  status: string | null;
  priceId: string | null;
  payingSince: string | null;
  endedAt: string | null;
}

export interface MonthFigures {
  /** YYYY-MM, Europe/Paris. */
  month: string;
  signups: number;
  newSubscriptions: number;
  cancellations: number;
}

export interface DashboardFigures {
  users: number;
  activeLast30Days: number;
  paying: number;
  trials: number;
  offered: number;
  /** past_due within the grace period (counted in `paying`). */
  inGrace: number;
  /** Estimated monthly recurring revenue, in cents. */
  mrrCents: number;
  current: MonthFigures;
  previous: MonthFigures;
}

const parisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" });
/** The Europe/Paris month (YYYY-MM) of an instant. */
export function monthOf(iso: string | Date): string {
  const parts = parisMonth.formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function dashboardFigures(accounts: readonly DashboardAccount[], yearlyPriceId: string | null, now: Date): DashboardFigures {
  const thirtyDaysAgo = now.getTime() - 30 * 86_400_000;
  const count = (test: (a: DashboardAccount) => boolean) => accounts.filter(test).length;
  const paying = accounts.filter((a) => a.plan === "Pro payant");
  const inMonth = (month: string): MonthFigures => ({
    month,
    signups: count((a) => monthOf(a.createdAt) === month),
    newSubscriptions: count((a) => a.payingSince !== null && monthOf(a.payingSince) === month),
    // Only a subscription that was paid: a trial that ends is not a cancellation.
    cancellations: count((a) => a.status === "canceled" && a.endedAt !== null && a.payingSince !== null && monthOf(a.endedAt) === month),
  });
  const current = monthOf(now);
  return {
    users: accounts.length,
    activeLast30Days: count((a) => a.lastSignInAt !== null && new Date(a.lastSignInAt).getTime() >= thirtyDaysAgo),
    paying: paying.length,
    trials: count((a) => a.plan === "Essai"),
    offered: count((a) => a.plan === "Pro offert"),
    inGrace: count((a) => a.plan === "Pro payant" && a.status === "past_due"),
    // Integer cents: 39 € a year = 325 cents a month.
    mrrCents: paying.reduce((sum, a) => sum + (yearlyPriceId && a.priceId === yearlyPriceId ? Math.round(YEARLY_CENTS / 12) : MONTHLY_CENTS), 0),
    current: inMonth(current),
    previous: inMonth(previousMonth(current)),
  };
}
