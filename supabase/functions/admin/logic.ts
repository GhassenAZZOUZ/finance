/**
 * Back-office rules (issue #156, US-13): who may call an admin action, and the request checks.
 * Pure: shared by the Edge Function (Deno) and the unit tests (Node). The caller's identity always
 * comes from the verified JWT; any `user_id`, `role` or `is_admin` in the body is ignored.
 */

export interface Claims {
  sub: string;
  /** « aal2 » once the TOTP second factor was checked in this session. */
  aal: string | null;
  exp: number;
}

/** The JWT's claims (the signature is checked by Supabase before the function runs). */
export function claimsOf(authorization: string | null): Claims | null {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    if (typeof json?.sub !== "string" || typeof json?.exp !== "number") return null;
    return { sub: json.sub, aal: typeof json.aal === "string" ? json.aal : null, exp: json.exp };
  } catch {
    return null;
  }
}

export type Denial = { status: 401; error: "unauthorized" } | { status: 403; error: "forbidden" | "mfa_required" };

/**
 * 401 without a valid session; 403 for a non-admin; 403 « mfa_required » for an admin whose session
 * has not passed the TOTP code (owner decision: second factor mandatory). Null: allowed.
 */
export function deny(claims: Claims | null, isAdmin: boolean, nowSeconds: number): Denial | null {
  if (!claims || claims.exp <= nowSeconds) return { status: 401, error: "unauthorized" };
  if (!isAdmin) return { status: 403, error: "forbidden" };
  if (claims.aal !== "aal2") return { status: 403, error: "mfa_required" };
  return null;
}

export const ACTIONS = ["whoami", "admins.list", "admins.add", "admins.remove", "audit.list", "users.list", "users.export", "plan.grant", "plan.revoke"] as const;
export type Action = (typeof ACTIONS)[number];

export type Request =
  | { action: "whoami" | "admins.list" | "audit.list" }
  | { action: "admins.add"; email: string }
  | { action: "admins.remove"; userId: string }
  // The list query is read by parseListQuery (users.ts): this file imports nothing (Deno and Node).
  | { action: "users.list" | "users.export" | "plan.grant" | "plan.revoke"; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** E-mails compared ignoring case and surrounding spaces (owner decision). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The request body, or null when malformed. Identity fields in it are never read. */
export function parseRequest(body: unknown): Request | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case "whoami":
    case "admins.list":
    case "audit.list":
      return { action: b.action };
    case "admins.add": {
      const email = typeof b.email === "string" ? normalizeEmail(b.email) : "";
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 320 ? { action: "admins.add", email } : null;
    }
    case "users.list":
    case "users.export":
    case "plan.grant":
    case "plan.revoke":
      return { action: b.action, body: b };
    case "admins.remove":
      return typeof b.userId === "string" && UUID.test(b.userId) ? { action: "admins.remove", userId: b.userId } : null;
    default:
      return null;
  }
}

export type RemovalRefusal = "self" | "last_admin" | "not_admin";

/** Nobody removes themselves, and the last admin stays (owner decision). */
export function removalRefusal(callerId: string, targetId: string, adminIds: readonly string[]): RemovalRefusal | null {
  if (!adminIds.includes(targetId)) return "not_admin";
  if (targetId === callerId) return "self";
  if (adminIds.length <= 1) return "last_admin";
  return null;
}
