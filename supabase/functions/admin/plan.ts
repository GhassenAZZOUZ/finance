/**
 * Offering or removing Pro from the back-office (issue #158, US-15; owner decisions 2026-10-07).
 * Pure, imports nothing (shared by Deno and Node). A Stripe subscription is never changed here.
 */

export type PlanRequest =
  | { action: "plan.grant"; userId: string; reason: string; endsOn: string | null; confirm: boolean }
  | { action: "plan.revoke"; userId: string; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The request, or null when malformed: the reason is mandatory to offer Pro (1–200 characters). */
export function parsePlanRequest(b: Record<string, unknown>): PlanRequest | null {
  if (typeof b.userId !== "string" || !UUID.test(b.userId)) return null;
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (reason.length > 200) return null;
  if (b.action === "plan.revoke") return { action: "plan.revoke", userId: b.userId, reason };
  if (b.action !== "plan.grant" || reason.length < 1) return null;
  const endsOn = typeof b.endsOn === "string" && b.endsOn !== "" ? b.endsOn : null;
  if (endsOn !== null && !DATE.test(endsOn)) return null;
  return { action: "plan.grant", userId: b.userId, reason, endsOn, confirm: b.confirm === true };
}

/** Paris offset (minutes east of UTC) at an instant, from the platform's time zone data. */
function parisOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The end date is included, up to 23:59 Paris time (owner decision): Pro ends at midnight Paris
 * starting the next day, returned as an ISO instant.
 */
export function grantExpiry(endsOn: string): string {
  const [y, m, d] = endsOn.split("-").map(Number) as [number, number, number];
  const midnightUtc = Date.UTC(y, m - 1, d + 1);
  // Two passes: the offset at the guess, then at the corrected instant (DST changes at 1:00 or 2:00).
  let instant = midnightUtc - parisOffsetMinutes(new Date(midnightUtc)) * 60_000;
  instant = midnightUtc - parisOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant).toISOString();
}

export type GrantRefusal = "self" | "past_date" | "already_pro";

/**
 * Refusals: nobody offers Pro to themselves; the end date is not in the past; an account already
 * Pro (paid, trial or an active grant) needs a confirmation (owner decision: allowed with a warning).
 */
export function grantRefusal(callerId: string, request: Extract<PlanRequest, { action: "plan.grant" }>, alreadyPro: boolean, now: Date): GrantRefusal | null {
  if (request.userId === callerId) return "self";
  if (request.endsOn && new Date(grantExpiry(request.endsOn)) <= now) return "past_date";
  if (alreadyPro && !request.confirm) return "already_pro";
  return null;
}
