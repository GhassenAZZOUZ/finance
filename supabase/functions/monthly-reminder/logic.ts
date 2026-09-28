/**
 * Pure rules of the monthly reminder (SPEC D25, issue #6): no Deno or Node API, so the app's
 * Vitest suite tests it (tests/unit/reminder.test.ts) and the Edge Function imports it.
 */

export const REMINDER_TIME_ZONE = "Europe/Paris";

/** Calendar date in Paris: the reminder follows the owner's day, not UTC's. */
export function parisDate(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REMINDER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Last day of the month in Paris (28/29 February and 30-day months included). */
export function isLastDayOfMonth(now: Date): boolean {
  const { year, month, day } = parisDate(now);
  return day === daysInMonth(year, month);
}

/** "2026-09": the check-in month the reminder is about. */
export function reminderMonth(now: Date): string {
  const { year, month } = parisDate(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export interface ReminderEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The e-mail: a link to Suivi and an unsubscribe link, and no financial data (AC security).
 * `appUrl` = the site root with its base path, e.g. "https://ghassenazzouz.github.io/finance".
 */
export function reminderEmail(appUrl: string, month: string, token: string): ReminderEmail {
  const [year, m] = month.split("-");
  const label = `${MONTHS[Number(m) - 1]} ${year}`;
  const root = appUrl.replace(/\/+$/, "");
  const suivi = `${root}/suivi/?mois=${month}`;
  const unsubscribe = `${root}/rappel/?jeton=${encodeURIComponent(token)}`;
  return {
    subject: `Votre suivi de ${label} vous attend`,
    text: [
      "Bonjour,",
      "",
      `C’est la fin du mois : pensez à saisir votre suivi de ${label} (vos soldes d’épargne et de crédits).`,
      "",
      `Saisir le suivi : ${suivi}`,
      "",
      `Ne plus recevoir ce rappel : ${unsubscribe}`,
    ].join("\n"),
    html: [
      "<p>Bonjour,</p>",
      `<p>C’est la fin du mois : pensez à saisir votre suivi de <strong>${label}</strong> (vos soldes d’épargne et de crédits).</p>`,
      `<p><a href="${suivi}">Saisir le suivi de ${label}</a></p>`,
      `<p style="color:#666;font-size:12px"><a href="${unsubscribe}">Ne plus recevoir ce rappel</a></p>`,
    ].join("\n"),
  };
}
