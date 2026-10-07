/** Back-office rules (issue #156, US-13): who may call, request checks, admin list rules. */
import { describe, expect, it } from "vitest";
import { claimsOf, deny, normalizeEmail, parseRequest, removalRefusal } from "@/supabase/functions/admin/logic";

const NOW = 1_800_000_000;
const token = (payload: Record<string, unknown>) =>
  `Bearer h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("claimsOf", () => {
  it("reads sub, aal and exp from the Bearer token", () => {
    expect(claimsOf(token({ sub: "u1", aal: "aal2", exp: NOW + 60 }))).toEqual({ sub: "u1", aal: "aal2", exp: NOW + 60 });
    expect(claimsOf(token({ sub: "u1", exp: NOW + 60 }))?.aal).toBeNull();
  });

  it("is null without a usable token", () => {
    expect(claimsOf(null)).toBeNull();
    expect(claimsOf("Bearer nonsense")).toBeNull();
    expect(claimsOf(token({ exp: NOW }))).toBeNull();
    expect(claimsOf("Basic abc")).toBeNull();
  });
});

describe("deny (AC-03, AC-04, second factor)", () => {
  const admin = { sub: "u1", aal: "aal2", exp: NOW + 60 };

  it("401 without a session or with an expired one", () => {
    expect(deny(null, true, NOW)).toEqual({ status: 401, error: "unauthorized" });
    expect(deny({ ...admin, exp: NOW }, true, NOW)).toEqual({ status: 401, error: "unauthorized" });
  });

  it("403 for a non-admin, even with the second factor", () => {
    expect(deny(admin, false, NOW)).toEqual({ status: 403, error: "forbidden" });
  });

  it("403 « mfa_required » for an admin without the TOTP code in this session", () => {
    expect(deny({ ...admin, aal: "aal1" }, true, NOW)).toEqual({ status: 403, error: "mfa_required" });
    expect(deny({ ...admin, aal: null }, true, NOW)).toEqual({ status: 403, error: "mfa_required" });
  });

  it("lets an admin with the second factor through", () => {
    expect(deny(admin, true, NOW)).toBeNull();
  });
});

describe("parseRequest (AC-06)", () => {
  it("reads the action and its fields only, never an identity sent in the body", () => {
    expect(parseRequest({ action: "whoami", user_id: "someone", role: "admin", is_admin: true })).toEqual({ action: "whoami" });
    expect(parseRequest({ action: "admins.add", email: "  Alice@Example.COM " })).toEqual({ action: "admins.add", email: "alice@example.com" });
    expect(parseRequest({ action: "admins.remove", userId: "11111111-2222-3333-4444-555555555555" })).toEqual({
      action: "admins.remove",
      userId: "11111111-2222-3333-4444-555555555555",
    });
  });

  it("passes the list query of users.list / users.export on to parseListQuery", () => {
    expect(parseRequest({ action: "users.list", search: "ali", page: 2 })).toEqual({ action: "users.list", body: { action: "users.list", search: "ali", page: 2 } });
    expect(parseRequest({ action: "users.export" })?.action).toBe("users.export");
  });

  it("refuses an unknown action or a malformed field", () => {
    expect(parseRequest({ action: "drop_everything" })).toBeNull();
    expect(parseRequest({ action: "admins.add", email: "not-an-email" })).toBeNull();
    expect(parseRequest({ action: "admins.remove", userId: "1 or 1=1" })).toBeNull();
    expect(parseRequest(null)).toBeNull();
  });

  it("compares e-mails ignoring case and surrounding spaces", () => {
    expect(normalizeEmail(" A@B.fr ")).toBe("a@b.fr");
  });
});

describe("removalRefusal", () => {
  it("never removes oneself nor the last admin", () => {
    expect(removalRefusal("a", "a", ["a", "b"])).toBe("self");
    expect(removalRefusal("a", "b", ["b"])).toBe("last_admin");
    expect(removalRefusal("a", "c", ["a", "b"])).toBe("not_admin");
    expect(removalRefusal("a", "b", ["a", "b"])).toBeNull();
  });
});
