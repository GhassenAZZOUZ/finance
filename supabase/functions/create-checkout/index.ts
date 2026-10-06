/**
 * Stripe Checkout for the Pro plan (issue #141, US-4). Called by the signed-in website with the
 * user's JWT (verified by Supabase); returns the Checkout URL to redirect to. Pro is granted only by
 * the webhook (US-5), never here.
 * Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY, APP_URL; SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkoutParams, parsePlan } from "./logic.ts";

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
  const [stripeKey, monthly, yearly, appUrl] = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY", "APP_URL"].map(env);
  if (!stripeKey || !monthly || !yearly || !appUrl) return json({ error: "not_configured" }, 503);

  // The caller: from their own JWT, never from the body.
  const authHeader = req.headers.get("authorization") ?? "";
  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await asUser.auth.getUser();
  if (authError || !auth.user) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { plan?: unknown };
  const plan = parsePlan(body.plan);
  if (!plan) return json({ error: "invalid_plan" }, 400);

  // Their Stripe customer, if they already subscribed once (no second trial).
  const { data: existing } = await asUser.from("subscriptions").select("stripe_customer_id, status").maybeSingle<{
    stripe_customer_id: string;
    status: string;
  }>();
  if (existing && ["trialing", "active", "past_due"].includes(existing.status)) return json({ error: "already_subscribed" }, 409);

  const params = checkoutParams({
    userId: auth.user.id,
    email: auth.user.email ?? null,
    plan,
    prices: { monthly, yearly },
    appUrl: appUrl.replace(/\/+$/, ""),
    customerId: existing?.stripe_customer_id ?? null,
    firstSubscription: !existing,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${stripeKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const session = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    console.error("[create-checkout]", res.status, session.error?.message);
    return json({ error: "stripe_error" }, 502);
  }
  return json({ url: session.url });
});
