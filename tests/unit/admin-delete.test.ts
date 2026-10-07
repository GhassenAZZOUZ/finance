/** Account deletion from the back-office (issue #159, US-16), and its Stripe step. */
import { describe, expect, it, vi } from "vitest";
import { closeStripeAccount } from "@/supabase/functions/_shared/stripe-account";
import { deleteRefusal, deletionEmail, parseDeleteRequest } from "@/supabase/functions/admin/delete";

const USER = "11111111-2222-3333-4444-555555555555";
const ADMIN = "99999999-2222-3333-4444-555555555555";
const request = (over: Record<string, unknown> = {}) => parseDeleteRequest({ userId: USER, confirmEmail: " Alice@Example.test ", requestRef: " e-mail du 7/10 ", ...over });

describe("parseDeleteRequest", () => {
  it("needs a target, the typed e-mail and a reference of 1 to 200 characters", () => {
    expect(request()).toEqual({ userId: USER, confirmEmail: "alice@example.test", requestRef: "e-mail du 7/10" });
    expect(request({ userId: "nope" })).toBeNull();
    expect(request({ confirmEmail: "  " })).toBeNull();
    expect(request({ requestRef: "   " })).toBeNull();
    expect(request({ requestRef: "x".repeat(201) })).toBeNull();
    expect(request({ requestRef: "x".repeat(200) })).not.toBeNull();
  });
});

describe("deleteRefusal", () => {
  it("accepts the account's e-mail ignoring case and surrounding spaces", () => {
    expect(deleteRefusal(ADMIN, request()!, "alice@example.test", [ADMIN])).toBeNull();
  });
  it("refuses another e-mail, a missing one, one's own account and another admin", () => {
    expect(deleteRefusal(ADMIN, request()!, "bob@example.test", [ADMIN])).toBe("email_mismatch");
    expect(deleteRefusal(ADMIN, request()!, null, [ADMIN])).toBe("email_mismatch");
    expect(deleteRefusal(USER, request()!, "alice@example.test", [USER])).toBe("self");
    expect(deleteRefusal(ADMIN, request()!, "alice@example.test", [ADMIN, USER])).toBe("target_admin");
  });
});

describe("deletionEmail", () => {
  it("confirms the deletion in French, mentions the cancelled subscription only when there was one, no link", () => {
    const withSub = deletionEmail(true);
    expect(withSub.subject).toBe("Votre compte Boussole a été supprimé");
    expect(withSub.text).toContain("abonnement Pro a été résilié");
    expect(deletionEmail(false).text).not.toContain("abonnement");
    expect(withSub.html).not.toContain("href");
  });
});

/** A fake Stripe: each call answers with the next response. */
function fakeStripe(...responses: ({ status: number; body?: Record<string, unknown> } | "network")[]) {
  const fetchFn = vi.fn(async () => {
    const next = responses.shift()!;
    if (next === "network") throw new Error("timeout");
    return { ok: next.status < 300, status: next.status, json: async () => next.body ?? {} };
  });
  const calls = () => fetchFn.mock.calls.map((c) => { const [url, init] = c as unknown as [string, { method: string; body?: string }]; return `${init.method} ${url.replace("https://api.stripe.com/v1/", "")}${init.body ? ` ${init.body}` : ""}`; });
  return { fetchFn, calls };
}

const ACCOUNT = { customerId: "cus_A1", subscriptionId: "sub_B2" };

describe("closeStripeAccount", () => {
  it("cancels a live subscription (no refund parameters), then marks the kept customer", async () => {
    const s = fakeStripe({ status: 200, body: { status: "active" } }, { status: 200 }, { status: 200 });
    expect(await closeStripeAccount(s.fetchFn, "sk_test", ACCOUNT, "2026-10-08")).toEqual({ ok: true, cancelled: true });
    expect(s.calls()).toEqual(["GET subscriptions/sub_B2", "DELETE subscriptions/sub_B2", "POST customers/cus_A1 metadata%5Baccount_deleted%5D=2026-10-08"]);
  });

  it.each(["trialing", "past_due"])("cancels a %s subscription too", async (status) => {
    const s = fakeStripe({ status: 200, body: { status } }, { status: 200 }, { status: 200 });
    expect(await closeStripeAccount(s.fetchFn, "sk_test", ACCOUNT, "2026-10-08")).toEqual({ ok: true, cancelled: true });
  });

  it("does not cancel twice an already cancelled subscription (re-run after a failed deletion)", async () => {
    const s = fakeStripe({ status: 200, body: { status: "canceled" } }, { status: 200 });
    expect(await closeStripeAccount(s.fetchFn, "sk_test", ACCOUNT, "2026-10-08")).toEqual({ ok: true, cancelled: false });
    expect(s.calls()).toEqual(["GET subscriptions/sub_B2", "POST customers/cus_A1 metadata%5Baccount_deleted%5D=2026-10-08"]);
  });

  it("only marks a customer without subscription", async () => {
    const s = fakeStripe({ status: 200 });
    expect(await closeStripeAccount(s.fetchFn, "sk_test", { customerId: "cus_A1", subscriptionId: null }, "2026-10-08")).toEqual({ ok: true, cancelled: false });
    expect(s.calls()).toHaveLength(1);
  });

  it("stops at the first failure: error, timeout or a refused mark", async () => {
    expect(await closeStripeAccount(fakeStripe({ status: 200, body: { status: "active" } }, { status: 500 }).fetchFn, "k", ACCOUNT, "d")).toEqual({ ok: false, step: "cancel", status: 500 });
    expect(await closeStripeAccount(fakeStripe("network").fetchFn, "k", ACCOUNT, "d")).toEqual({ ok: false, step: "retrieve", status: 0 });
    expect(await closeStripeAccount(fakeStripe({ status: 200, body: { status: "canceled" } }, { status: 404 }).fetchFn, "k", ACCOUNT, "d")).toEqual({ ok: false, step: "mark", status: 404 });
  });
});
