/**
 * AC-01 (#13) and #3: log in with the 6-digit code or the link of the same e-mail, read from the
 * local mail catcher; both land on the dashboard (after the guided tour).
 */
import type { Page } from "@playwright/test";
import { createTestUser, deleteTestUser } from "../tests/integration/supabase-env";
import { expect, mailUrl, test } from "./fixtures";

interface Mail {
  Subject: string;
  HTML: string;
  Text: string;
}

async function loginMail(email: string): Promise<Mail> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) return (await (await fetch(`${mailUrl()}/api/v1/message/${messages[0]!.ID}`)).json()) as Mail;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no e-mail for ${email}`);
}

async function requestEmail(page: Page, email: string): Promise<Mail> {
  await page.goto("/login/");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir un code de connexion" }).click();
  await expect(page.getByRole("status")).toContainText(`E-mail envoyé à ${email}`);
  return loginMail(email);
}

/** A new user is greeted by the guided tour, then lands on the onboarding of the dashboard. */
async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  const tour = page.getByRole("dialog", { name: "Bienvenue dans Plan financier" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Passer" }).click();
  await expect(tour).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation principale" }).first()).toBeAttached();
}

test("signs in with the 6-digit code from the e-mail", async ({ page }, testInfo) => {
  const user = await createTestUser(`e2e-code-${testInfo.project.name}`);
  try {
    const mail = await requestEmail(page, user.email);
    const code = /\b(\d{6})\b/.exec(mail.Subject)?.[1];
    expect(code, "code in the subject").toBeTruthy();
    await page.getByLabel("Code de connexion").fill(code!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expectDashboard(page);
  } finally {
    await deleteTestUser(user);
  }
});

test("signs in with the link of the same e-mail", async ({ page }, testInfo) => {
  const user = await createTestUser(`e2e-link-${testInfo.project.name}`);
  try {
    const mail = await requestEmail(page, user.email);
    const link = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(mail.HTML)?.[1] ?? /(http\S*\/auth\/v1\/verify\S*)/.exec(mail.Text)?.[1];
    expect(link, "link in the e-mail").toBeTruthy();
    // Same browser context: the PKCE verifier stored when requesting the e-mail is still there.
    await page.goto(link!.replaceAll("&amp;", "&"));
    await expectDashboard(page);
  } finally {
    await deleteTestUser(user);
  }
});
