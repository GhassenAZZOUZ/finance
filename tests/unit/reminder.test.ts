/** Monthly reminder rules (issue #6, SPEC D25): last day of the month in Paris, e-mail content. */
import { describe, expect, it } from "vitest";
import { isLastDayOfMonth, reminderEmail, reminderMonth } from "@/supabase/functions/monthly-reminder/logic";

describe("isLastDayOfMonth (Europe/Paris)", () => {
  it.each([
    ["2026-09-30T16:00:00Z", true],
    ["2026-09-29T16:00:00Z", false],
    ["2027-02-28T16:00:00Z", true], // 28 days
    ["2028-02-28T16:00:00Z", false], // leap year: the 29th is the last day
    ["2028-02-29T16:00:00Z", true],
    ["2026-04-30T16:00:00Z", true], // 30-day month
    ["2026-12-31T16:00:00Z", true],
  ])("%s → %s", (iso, last) => expect(isLastDayOfMonth(new Date(iso))).toBe(last));

  it("uses the Paris day around midnight UTC", () => {
    // 30 Sept 22:30 UTC = 1 Oct 00:30 in Paris (summer time): no longer the last day.
    expect(isLastDayOfMonth(new Date("2026-09-30T22:30:00Z"))).toBe(false);
    // 31 Oct 23:30 UTC = 1 Nov 00:30 in Paris (winter time).
    expect(isLastDayOfMonth(new Date("2026-10-31T23:30:00Z"))).toBe(false);
    expect(isLastDayOfMonth(new Date("2026-10-31T22:30:00Z"))).toBe(true);
    expect(reminderMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01");
  });
});

describe("reminderEmail", () => {
  const mail = reminderEmail("https://ghassenazzouz.github.io/finance/", "2026-09", "tok-123");

  it("names the month and links to Suivi and to the unsubscribe page", () => {
    expect(mail.subject).toBe("Votre suivi de septembre 2026 vous attend");
    expect(mail.html).toContain('href="https://ghassenazzouz.github.io/finance/suivi/?mois=2026-09"');
    expect(mail.html).toContain('href="https://ghassenazzouz.github.io/finance/rappel/?jeton=tok-123"');
    expect(mail.text).toContain("https://ghassenazzouz.github.io/finance/suivi/?mois=2026-09");
  });

  it("contains no amount (no financial data)", () => {
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/€|\d+[,.]\d{2}/);
  });
});
