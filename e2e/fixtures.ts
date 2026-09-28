/**
 * Shared E2E fixtures (issue #13). Everything runs against the LOCAL Supabase stack (see
 * tests/integration/supabase-env.ts); each test gets its own throwaway user, deleted afterwards.
 */
import { test as base, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTestUser, deleteTestUser, localSupabase, type TestUser } from "../tests/integration/supabase-env";

export { expect };

/** localStorage key used by supabase-js for this project URL ("sb-127-auth-token" locally). */
export function authStorageKey(): string {
  return `sb-${new URL(localSupabase().url).hostname.split(".")[0]}-auth-token`;
}

/** Local mail catcher (Mailpit, "inbucket" in supabase/config.toml). */
export function mailUrl(): string {
  if (process.env.SUPABASE_MAIL_URL) return process.env.SUPABASE_MAIL_URL;
  const api = new URL(localSupabase().url);
  // The CLI puts the mail UI on the API port + 3 (54321 → 54324, 55321 → 55324).
  return `${api.protocol}//${api.hostname}:${Number(api.port) + 3}`;
}

/** Signs the page in as `user` before any script runs (the static app reads the session from localStorage). */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  const { data, error } = await user.client.auth.getSession();
  if (error || !data.session) throw error ?? new Error("test user has no session");
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [authStorageKey(), JSON.stringify(data.session)] as const);
}

/** Plan parameters and budget written straight to the database, for journeys that need a plan. */
export async function seedPlan(client: SupabaseClient, userId: string, startMonth: string): Promise<void> {
  const settings = await client.from("budget_settings").upsert({
    user_id: userId,
    start_month: startMonth,
    moving_goal: 1000,
    moving_deadline_month: startMonth,
    moving_already_saved: 1000,
    emergency_target: 1000,
    emergency_existing: 1000,
    risk_free_rate: 0.02,
    early_repayment_pct: 0.5,
  });
  if (settings.error) throw settings.error;
  const lines = await client.from("budget_lines").delete().eq("user_id", userId);
  if (lines.error) throw lines.error;
  const insert = await client.from("budget_lines").insert([
    { user_id: userId, category: "income", label: "Salaire", amount: 3000, position: 0 },
    { user_id: userId, category: "fixed", label: "Loyer", amount: 900, position: 0 },
    { user_id: userId, category: "variable", label: "Courses", amount: 400, position: 0 },
  ]);
  if (insert.error) throw insert.error;
}

/** A fresh confirmed user per test, signed in on `page`; deleted after the test. */
export const test = base.extend<{ user: TestUser }>({
  user: async ({ page }, provide, testInfo) => {
    const user = await createTestUser(`e2e-${testInfo.project.name}`);
    await signIn(page, user);
    await provide(user);
    await deleteTestUser(user);
  },
});
