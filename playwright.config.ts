import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the main journeys (issue #13), against the local Supabase stack only.
 * CI builds the static export and serves it on :3000 (the auth redirect URL of supabase/config.toml);
 * locally a running `npm run dev` is reused.
 */
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  // Each test has its own user, so files can run in parallel.
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: CI ? "npm run build && node scripts/serve-static.mjs out 3000" : "npm run dev",
    url: "http://localhost:3000/login/",
    reuseExistingServer: !CI,
    timeout: 300_000,
  },
});
