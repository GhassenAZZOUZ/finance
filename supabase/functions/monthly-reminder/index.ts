/**
 * Monthly check-in reminder (SPEC D25, issue #6). Called once a day by the scheduled GitHub
 * Action `.github/workflows/reminder.yml` with the shared secret REMINDER_SECRET; sends only on the
 * last day of the month (Paris). Secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
 * REMINDER_SECRET, APP_URL; SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
 *
 * POST body (optional): { "force": true } skips the last-day check (manual test run),
 * { "month": "YYYY-MM" } overrides the month, { "dryRun": true } lists recipients without sending.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";
import { isLastDayOfMonth, reminderEmail, reminderMonth } from "./logic.ts";

const env = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing secret ${name}`);
  return value;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (req.headers.get("x-reminder-secret") !== env("REMINDER_SECRET")) return json({ error: "unauthorized" }, 401);

  const options = (await req.json().catch(() => ({}))) as { force?: boolean; month?: string; dryRun?: boolean };
  const now = new Date();
  if (!options.force && !isLastDayOfMonth(now)) return json({ skipped: "not the last day of the month" });
  const month = options.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(options.month) ? options.month : reminderMonth(now);

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: recipients, error } = await db.rpc("reminder_recipients", { p_month: month });
  if (error) return json({ error: `recipients: ${error.message}` }, 500);
  const list = (recipients ?? []) as { user_id: string; email: string; token: string }[];
  if (options.dryRun) return json({ month, dryRun: true, recipients: list.length });

  const port = Number(env("SMTP_PORT"));
  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASSWORD") },
  });

  let sent = 0;
  const failed: string[] = [];
  for (const r of list) {
    // Claim the (user, month) first: a retried run never sends twice.
    const claim = await db.from("reminder_log").insert({ user_id: r.user_id, month }).select("user_id");
    if (claim.error) {
      if (claim.error.code !== "23505") failed.push(r.user_id);
      continue;
    }
    const mail = reminderEmail(env("APP_URL"), month, r.token);
    try {
      await transport.sendMail({ from: env("SMTP_FROM"), to: r.email, subject: mail.subject, text: mail.text, html: mail.html });
      sent++;
    } catch (error) {
      // Visible in the function logs (Supabase dashboard); the address and secrets are not logged.
      console.error(`reminder not sent to ${r.user_id}: ${error instanceof Error ? error.message : String(error)}`);
      // Release the claim so the next run retries this user.
      await db.from("reminder_log").delete().eq("user_id", r.user_id).eq("month", month);
      failed.push(r.user_id);
    }
  }
  // A failure makes the scheduled run red (visible in GitHub Actions, AC-08).
  return json({ month, recipients: list.length, sent, failed: failed.length }, failed.length > 0 ? 500 : 200);
});
