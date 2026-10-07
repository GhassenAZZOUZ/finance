/**
 * Stripe side of an account deletion (issue #159, US-16; also « Supprimer mon compte », #37), run
 * BEFORE the database deletion: if it fails, nothing is deleted. Owner decisions 2026-10-07: the
 * subscription is cancelled immediately without refund (no proration, no final invoice); the Stripe
 * customer is kept for accounting (invoices are kept 10 years) and marked « account_deleted » in its
 * metadata. Running it again is safe: an already cancelled subscription is not cancelled twice.
 * Pure (no imports, `fetch` passed in): shared by the Edge Functions (Deno) and the unit tests (Node).
 */

export interface StripeAccount {
  customerId: string;
  subscriptionId: string | null;
}

export type StripeCloseResult = { ok: true; cancelled: boolean } | { ok: false; step: "retrieve" | "cancel" | "mark"; status: number };

/** Statuses that can still bill the customer: cancelled now. */
const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export async function closeStripeAccount(fetchFn: Fetch, secretKey: string, account: StripeAccount, deletedOn: string): Promise<StripeCloseResult> {
  const call = async (method: string, path: string, body?: URLSearchParams) => {
    try {
      const res = await fetchFn(`https://api.stripe.com/v1/${path}`, {
        method,
        headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
        body: body?.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      return { status: res.status, ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } catch {
      // Network error or timeout.
      return { status: 0, ok: false, data: {} };
    }
  };

  let cancelled = false;
  if (account.subscriptionId) {
    const sub = await call("GET", `subscriptions/${encodeURIComponent(account.subscriptionId)}`);
    if (!sub.ok) return { ok: false, step: "retrieve", status: sub.status };
    if (LIVE.has(String(sub.data.status))) {
      // Default cancellation: immediate, no prorated credit, no final invoice.
      const del = await call("DELETE", `subscriptions/${encodeURIComponent(account.subscriptionId)}`);
      if (!del.ok) return { ok: false, step: "cancel", status: del.status };
      cancelled = true;
    }
  }
  const mark = await call("POST", `customers/${encodeURIComponent(account.customerId)}`, new URLSearchParams({ "metadata[account_deleted]": deletedOn }));
  if (!mark.ok) return { ok: false, step: "mark", status: mark.status };
  return { ok: true, cancelled };
}
