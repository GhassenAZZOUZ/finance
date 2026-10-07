/**
 * « Supprimer mon compte » for a user who has (or had) a Stripe subscription (issue #159, owner
 * decision 2026-10-07: same Stripe behaviour as the back-office deletion). Cancels the subscription
 * immediately without refund and marks the Stripe customer, then deletes the account with the
 * caller's own `delete_my_account()` (bound to auth.uid()). If Stripe fails, nothing is deleted.
 * Users without a subscription call `delete_my_account()` directly (lib/data).
 * Secrets: STRIPE_SECRET_KEY; SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
 * Deployed with JWT verification on.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { closeStripeAccount } from "../_shared/stripe-account.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = (name: string) => Deno.env.get(name) ?? "";
  // The caller: from their own JWT, never from the body.
  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: req.headers.get("authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await asUser.auth.getUser();
  if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

  const { data: sub, error: subError } = await asUser
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .maybeSingle<{ stripe_customer_id: string; stripe_subscription_id: string | null }>();
  if (subError) return json({ error: "failed" }, 500);
  if (sub) {
    const key = env("STRIPE_SECRET_KEY");
    if (!key) return json({ error: "not_configured" }, 503);
    const closed = await closeStripeAccount(fetch, key, { customerId: sub.stripe_customer_id, subscriptionId: sub.stripe_subscription_id }, new Date().toISOString().slice(0, 10));
    if (!closed.ok) {
      console.error("[delete-account] stripe", closed.step, closed.status);
      return json({ error: "stripe_error" }, 502);
    }
  }
  const { error } = await asUser.rpc("delete_my_account");
  if (error) return json({ error: sub ? "delete_failed_after_stripe" : "failed" }, 500);
  return json({ deleted: true });
});
