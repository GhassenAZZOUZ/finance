/**
 * Stripe webhook (issue #142, US-5): the only source of truth of subscriptions (SPEC D35). Stripe
 * calls it for each event; the signature is checked with the endpoint secret, then the event is
 * applied in one transaction by `apply_stripe_event` (idempotent on the event id, stale events
 * ignored). Fast 2xx; 5xx on an error so that Stripe retries.
 * Secrets: STRIPE_WEBHOOK_SECRET; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
 * Deployed with --no-verify-jwt: Stripe has no user JWT, the signature is the guard.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { eventAction, verifyStripeSignature } from "./logic.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // Not configured yet: Stripe retries later.
  if (!secret || !url || !serviceKey) return json({ error: "not configured" }, 500);

  // The raw body: the signature covers the exact bytes Stripe sent.
  const payload = await req.text();
  const signed = await verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret, Math.floor(Date.now() / 1000));
  if (!signed) return json({ error: "invalid signature" }, 400);

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const id = typeof event.id === "string" ? event.id : "";
  const type = typeof event.type === "string" ? event.type : "";
  const created = typeof event.created === "number" ? new Date(event.created * 1000).toISOString() : null;
  if (!/^evt_[A-Za-z0-9]+$/.test(id) || !type || !created) return json({ error: "invalid event" }, 400);

  const action = eventAction(event);
  const change = action.kind === "subscription" ? { kind: "subscription", ...action.change } : action;

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc("apply_stripe_event", { p_event_id: id, p_type: type, p_created: created, p_change: change });
  if (error) {
    console.error("[stripe-webhook]", id, type, error.message);
    return json({ error: "not applied" }, 500);
  }
  return json({ received: true, result: data });
});
