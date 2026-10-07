/**
 * Back-office (issue #156, US-13, epic #161): the single entry point of every admin action. Checks
 * the caller's JWT, that they are in `admins`, and that their session passed the TOTP code (aal2);
 * only then uses the service role. Every action that changes something is written to `admin_audit`.
 * Never reads the financial tables. Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Deployed with JWT verification on.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { claimsOf, deny, normalizeEmail, parseRequest, removalRefusal } from "./logic.ts";
import { type AccountInput, type GrantInput, type SubscriptionInput, type UserRow, filterAndSort, page, parseListQuery, toCsv, userRows } from "./users.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** E-mail of each account id (the auth admin API has no lookup by e-mail: small user base). */
async function emails(db: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email) map.set(u.id, u.email);
    if (data.users.length < 1000) break;
  }
  return map;
}

/** Every account with its plan and two counts (US-14). Never the financial tables' content. */
async function allUsers(db: SupabaseClient): Promise<UserRow[]> {
  const accounts: AccountInput[] = [];
  for (let p = 1; p <= 50; p++) {
    const { data, error } = await db.auth.admin.listUsers({ page: p, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) accounts.push({ id: u.id, email: u.email ?? null, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }
  const [subs, grants, counts] = await Promise.all([
    db.from("subscriptions").select("user_id, status, current_period_end, cancel_at_period_end, past_due_since"),
    db.from("pro_grants").select("user_id, reason, expires_at"),
    db.rpc("admin_usage_counts", { p_users: accounts.map((a) => a.id) }),
  ]);
  for (const r of [subs, grants, counts]) if (r.error) throw r.error;
  const subscriptions = new Map<string, SubscriptionInput>(
    (subs.data ?? []).map((s) => [s.user_id, { status: s.status, currentPeriodEnd: s.current_period_end, cancelAtPeriodEnd: s.cancel_at_period_end, pastDueSince: s.past_due_since }]),
  );
  const grantMap = new Map<string, GrantInput>((grants.data ?? []).map((g) => [g.user_id, { reason: g.reason, expiresAt: g.expires_at }]));
  const countMap = new Map<string, { loans: number; goals: number }>(
    ((counts.data ?? []) as { user_id: string; loans: number; goals: number }[]).map((c) => [c.user_id, { loans: c.loans, goals: c.goals }]),
  );
  return userRows(accounts, subscriptions, grantMap, countMap, new Date());
}

async function audit(db: SupabaseClient, adminId: string, action: string, targetUser: string | null, details: Record<string, unknown> = {}) {
  const { error } = await db.from("admin_audit").insert({ admin_id: adminId, action, target_user: targetUser, details });
  if (error) throw error;
  // 12-month retention (owner decision).
  await db.rpc("purge_admin_audit");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = (name: string) => Deno.env.get(name) ?? "";
  const authorization = req.headers.get("authorization");
  const claims = claimsOf(authorization);
  // The token is checked against Auth too (revoked sessions), with the caller's own rights.
  const asUser = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { authorization: authorization ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: me } = claims ? await asUser.auth.getUser() : { data: { user: null } };
  const caller = me.user && claims && me.user.id === claims.sub ? claims : null;

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: adminRow } = caller ? await db.from("admins").select("user_id").eq("user_id", caller.sub).maybeSingle() : { data: null };
  const refusal = deny(caller, adminRow !== null, Math.floor(Date.now() / 1000));
  if (refusal) return json({ error: refusal.error }, refusal.status);
  const adminId = caller!.sub;

  const request = parseRequest(await req.json().catch(() => null));
  if (!request) return json({ error: "invalid_request" }, 400);

  try {
    switch (request.action) {
      case "whoami":
        return json({ admin: true, userId: adminId, email: me.user!.email ?? null });

      case "admins.list": {
        const { data, error } = await db.from("admins").select("user_id, added_at").order("added_at");
        if (error) throw error;
        const byId = await emails(db);
        return json({ admins: (data ?? []).map((a) => ({ userId: a.user_id, email: byId.get(a.user_id) ?? null, addedAt: a.added_at })) });
      }

      case "admins.add": {
        const byId = await emails(db);
        const target = [...byId].find(([, email]) => normalizeEmail(email) === request.email)?.[0];
        if (!target) return json({ error: "user_not_found" }, 404);
        const { error } = await db.from("admins").upsert({ user_id: target, added_by: adminId }, { onConflict: "user_id", ignoreDuplicates: true });
        if (error) throw error;
        await audit(db, adminId, "admins.add", target);
        return json({ added: true, userId: target });
      }

      case "admins.remove": {
        const { data } = await db.from("admins").select("user_id");
        const why = removalRefusal(adminId, request.userId, (data ?? []).map((a) => a.user_id));
        if (why) return json({ error: why }, 409);
        const { error } = await db.from("admins").delete().eq("user_id", request.userId);
        if (error) throw error;
        await audit(db, adminId, "admins.remove", request.userId);
        return json({ removed: true });
      }

      case "users.list": {
        // Viewing is not audited (owner decision): only changes and exports.
        const query = parseListQuery(request.body);
        const rows = filterAndSort(await allUsers(db), query);
        return json(page(rows, query.page));
      }

      case "users.export": {
        const query = parseListQuery(request.body);
        const rows = filterAndSort(await allUsers(db), query);
        const filters = { search: query.search, plan: query.plan, status: query.status, sort: query.sort };
        await audit(db, adminId, "users.export", null, { count: rows.length, filters });
        return json({ csv: toCsv(rows), count: rows.length });
      }

      case "audit.list": {
        const { data, error } = await db.from("admin_audit").select("id, at, admin_id, action, target_user, details").order("at", { ascending: false }).limit(200);
        if (error) throw error;
        const byId = await emails(db);
        return json({
          entries: (data ?? []).map((e) => ({
            id: e.id,
            at: e.at,
            action: e.action,
            admin: byId.get(e.admin_id) ?? e.admin_id,
            target: e.target_user ? (byId.get(e.target_user) ?? "compte supprimé") : null,
            details: e.details,
          })),
        });
      }
    }
  } catch (error) {
    console.error("[admin]", request.action, error);
    return json({ error: "failed" }, 500);
  }
});
