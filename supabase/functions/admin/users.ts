/**
 * Back-office user list (issue #157, US-14; owner decisions 2026-10-07). Pure: builds the rows from
 * the account, subscription and grant data the Edge Function reads, then filters, sorts, pages and
 * exports them. Only account and subscription information, plus two counts: never financial data.
 */

export type PlanLabel = "Pro payant" | "Essai" | "Pro offert" | "Free";
export type StatusFilter = "trialing" | "active" | "past_due" | "canceled" | "cancel_scheduled";
export type SortKey = "created" | "last_sign_in";

export const PAGE_SIZE = 50;
const GRACE_DAYS = 7;

export interface AccountInput {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}
export interface SubscriptionInput {
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
}
export interface GrantInput {
  reason: string;
  expiresAt: string | null;
}

export interface UserRow {
  userId: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  plan: PlanLabel;
  /** Stripe status as received, null without a subscription. */
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  loans: number;
  goals: number;
}

/** One label, by priority: paying Pro > trial > offered Pro > Free (owner decision). */
export function planLabel(sub: SubscriptionInput | null, grant: GrantInput | null, now: Date): PlanLabel {
  if (sub) {
    const inGrace = sub.status === "past_due" && (!sub.pastDueSince || now.getTime() < new Date(sub.pastDueSince).getTime() + GRACE_DAYS * 86_400_000);
    if (sub.status === "active" || inGrace) return "Pro payant";
    if (sub.status === "trialing") return "Essai";
  }
  if (grant && (!grant.expiresAt || new Date(grant.expiresAt) > now)) return "Pro offert";
  return "Free";
}

export function userRows(
  accounts: readonly AccountInput[],
  subscriptions: ReadonlyMap<string, SubscriptionInput>,
  grants: ReadonlyMap<string, GrantInput>,
  counts: ReadonlyMap<string, { loans: number; goals: number }>,
  now: Date,
): UserRow[] {
  return accounts.map((a) => {
    const sub = subscriptions.get(a.id) ?? null;
    return {
      userId: a.id,
      email: a.email ?? "",
      createdAt: a.createdAt,
      lastSignInAt: a.lastSignInAt,
      plan: planLabel(sub, grants.get(a.id) ?? null, now),
      status: sub?.status ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      loans: counts.get(a.id)?.loans ?? 0,
      goals: counts.get(a.id)?.goals ?? 0,
    };
  });
}

export interface ListQuery {
  search: string;
  plan: PlanLabel | null;
  status: StatusFilter | null;
  sort: SortKey;
  page: number;
}

const PLANS: readonly PlanLabel[] = ["Pro payant", "Essai", "Pro offert", "Free"];
const STATUSES: readonly StatusFilter[] = ["trialing", "active", "past_due", "canceled", "cancel_scheduled"];

/** The query from the request body (anything unknown falls back to « all », page 1). */
export function parseListQuery(b: Record<string, unknown>): ListQuery {
  const search = typeof b.search === "string" ? b.search.trim().toLowerCase().slice(0, 100) : "";
  const plan = PLANS.includes(b.plan as PlanLabel) ? (b.plan as PlanLabel) : null;
  const status = STATUSES.includes(b.status as StatusFilter) ? (b.status as StatusFilter) : null;
  const sort: SortKey = b.sort === "last_sign_in" ? "last_sign_in" : "created";
  const page = Number.isInteger(b.page) && (b.page as number) >= 1 ? (b.page as number) : 1;
  return { search, plan, status, sort, page };
}

function matchesStatus(row: UserRow, status: StatusFilter): boolean {
  // « Résiliation programmée » = still running, set to end at the period end (owner decision).
  if (status === "cancel_scheduled") return row.cancelAtPeriodEnd && row.status !== "canceled";
  return row.status === status;
}

/** Partial e-mail search ignoring case, plan and status filters, sorted newest first. */
export function filterAndSort(rows: readonly UserRow[], q: Omit<ListQuery, "page">): UserRow[] {
  const key = (r: UserRow) => (q.sort === "last_sign_in" ? (r.lastSignInAt ?? "") : r.createdAt);
  return rows
    .filter((r) => (q.search ? r.email.toLowerCase().includes(q.search) : true))
    .filter((r) => (q.plan ? r.plan === q.plan : true))
    .filter((r) => (q.status ? matchesStatus(r, q.status) : true))
    .sort((a, b) => key(b).localeCompare(key(a)));
}

export function page<T>(rows: readonly T[], n: number): { rows: T[]; total: number; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, n), pages);
  return { rows: rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: rows.length, page: p, pages };
}

const CSV_COLUMNS: [string, (r: UserRow) => string | number | null][] = [
  ["email", (r) => r.email],
  ["inscription", (r) => r.createdAt],
  ["derniere_connexion", (r) => r.lastSignInAt],
  ["plan", (r) => r.plan],
  ["statut_abonnement", (r) => r.status],
  ["fin_de_periode", (r) => r.currentPeriodEnd],
  ["resiliation_programmee", (r) => (r.cancelAtPeriodEnd ? "oui" : "non")],
  ["credits", (r) => r.loans],
  ["objectifs", (r) => r.goals],
];

/** The export (owner decision): the list's columns, never financial data. Excel-safe (formula prefix neutralised). */
export function toCsv(rows: readonly UserRow[]): string {
  const cell = (v: string | number | null) => {
    let text = v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [CSV_COLUMNS.map(([name]) => name).join(";"), ...rows.map((r) => CSV_COLUMNS.map(([, get]) => cell(get(r))).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
