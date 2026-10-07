/** Offering or removing Pro from the back-office (issue #158, US-15). */
import { describe, expect, it } from "vitest";
import { grantExpiry, grantRefusal, parsePlanRequest } from "@/supabase/functions/admin/plan";

const USER = "11111111-2222-3333-4444-555555555555";
const ADMIN = "99999999-2222-3333-4444-555555555555";

describe("parsePlanRequest", () => {
  it("requires a reason to offer Pro, the end date being optional", () => {
    expect(parsePlanRequest({ action: "plan.grant", userId: USER, reason: "  Geste commercial  " })).toEqual({
      action: "plan.grant",
      userId: USER,
      reason: "Geste commercial",
      endsOn: null,
      confirm: false,
    });
    expect(parsePlanRequest({ action: "plan.grant", userId: USER, reason: "  " })).toBeNull();
    expect(parsePlanRequest({ action: "plan.grant", userId: USER, reason: "x".repeat(201) })).toBeNull();
    expect(parsePlanRequest({ action: "plan.grant", userId: USER, reason: "ok", endsOn: "2027-13-01" })).toBeNull();
    expect(parsePlanRequest({ action: "plan.grant", userId: USER, reason: "ok", endsOn: "2027-12-31", confirm: true })).toMatchObject({ confirm: true });
  });

  it("removes with an optional reason; refuses a malformed account id", () => {
    expect(parsePlanRequest({ action: "plan.revoke", userId: USER })).toEqual({ action: "plan.revoke", userId: USER, reason: "" });
    expect(parsePlanRequest({ action: "plan.revoke", userId: "nope" })).toBeNull();
  });
});

describe("grantExpiry (end date included, until 23:59 in Paris)", () => {
  it("ends at the following midnight, Paris time, winter and summer", () => {
    expect(grantExpiry("2027-01-15")).toBe("2027-01-15T23:00:00.000Z");
    expect(grantExpiry("2027-07-15")).toBe("2027-07-15T22:00:00.000Z");
  });

  it("handles the days the clocks change", () => {
    // 2027-03-28: summer time starts; midnight after it is in summer time (UTC+2).
    expect(grantExpiry("2027-03-28")).toBe("2027-03-28T22:00:00.000Z");
    // 2027-10-31: winter time starts; midnight after it is in winter time (UTC+1).
    expect(grantExpiry("2027-10-31")).toBe("2027-10-31T23:00:00.000Z");
  });
});

describe("grantRefusal", () => {
  const now = new Date("2027-03-15T12:00:00Z");
  const grant = (over = {}) => ({ action: "plan.grant" as const, userId: USER, reason: "ok", endsOn: null, confirm: false, ...over });

  it("refuses to offer Pro to oneself and an end date already past", () => {
    expect(grantRefusal(USER, grant(), false, now)).toBe("self");
    expect(grantRefusal(ADMIN, grant({ endsOn: "2027-03-14" }), false, now)).toBe("past_date");
    // Today is fine: Pro until 23:59 tonight.
    expect(grantRefusal(ADMIN, grant({ endsOn: "2027-03-15" }), false, now)).toBeNull();
  });

  it("asks for a confirmation when the account is already Pro", () => {
    expect(grantRefusal(ADMIN, grant(), true, now)).toBe("already_pro");
    expect(grantRefusal(ADMIN, grant({ confirm: true }), true, now)).toBeNull();
  });
});
