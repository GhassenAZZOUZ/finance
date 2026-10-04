/** Login code (issue #3, AC-08): the auth rate limits that stop repeated wrong codes stay configured. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");
const section = (name: string) => {
  const start = config.indexOf(`[${name}]`);
  const next = config.indexOf("\n[", start + 1);
  return config.slice(start, next === -1 ? undefined : next);
};
const value = (text: string, key: string) => text.match(new RegExp(String.raw`^${key}\s*=\s*"?([^"\r\n]+)"?`, "m"))?.[1];

describe("#3 AC-08 — repeated wrong attempts are rate-limited", () => {
  it("limits code verifications and sign-ins per IP", () => {
    const limits = section("auth.rate_limit");
    expect(Number(value(limits, "token_verifications"))).toBeGreaterThan(0);
    expect(Number(value(limits, "token_verifications"))).toBeLessThanOrEqual(30);
    expect(Number(value(limits, "sign_in_sign_ups"))).toBeGreaterThan(0);
  });

  it("sends 6-digit codes that expire", () => {
    const email = section("auth.email");
    expect(value(email, "otp_length")).toBe("6");
    expect(Number(value(email, "otp_expiry"))).toBeGreaterThan(0);
  });
});
