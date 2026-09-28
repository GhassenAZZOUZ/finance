/** AC-01: login with the magic link, read from the local mail catcher, lands on the dashboard. */
import { createTestUser, deleteTestUser } from "../tests/integration/supabase-env";
import { expect, mailUrl, test } from "./fixtures";

async function magicLink(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = (await (await fetch(`${mailUrl()}/api/v1/message/${messages[0]!.ID}`)).json()) as { HTML: string; Text: string };
      const link = /href="([^"]*\/auth\/v1\/verify[^"]*)"/.exec(message.HTML)?.[1] ?? /(http\S*\/auth\/v1\/verify\S*)/.exec(message.Text)?.[1];
      if (!link) throw new Error("no magic link in the e-mail");
      return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no e-mail for ${email}`);
}

test("signs in with the e-mailed link and shows the dashboard", async ({ page }, testInfo) => {
  const user = await createTestUser(`e2e-login-${testInfo.project.name}`);
  try {
    await page.goto("/login/");
    await page.getByLabel("Adresse e-mail").fill(user.email);
    await page.getByRole("button", { name: "Recevoir un lien de connexion" }).click();
    await expect(page.getByRole("status")).toContainText(`Lien envoyé à ${user.email}`);

    // Same browser context: the PKCE verifier stored when requesting the link is still there.
    await page.goto(await magicLink(user.email));
    await expect(page).toHaveURL(/\/$/);
    // A new user lands on the onboarding of the dashboard.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation principale" }).first()).toBeAttached();
  } finally {
    await deleteTestUser(user);
  }
});
