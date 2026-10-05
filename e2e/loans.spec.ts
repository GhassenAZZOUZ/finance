/** AC-03: add a loan, then raise its principal: the debt-free month on the dashboard moves later. */
import { addMonths } from "../lib/engine";
import { currentYearMonth } from "../lib/format";
import { expect, seedPlan, test } from "./fixtures";

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * "Sans dettes en novembre 2026" (desktop tile) or "fin en novembre 2026" (mobile home's Dettes card,
 * #109) → months since year 0, for comparisons.
 */
async function debtFreeIndex(page: import("@playwright/test").Page): Promise<number> {
  await page.goto("/");
  const mobile = test.info().project.name === "mobile";
  const kpis = mobile ? page.getByRole("list", { name: "Chiffres clés" }) : page.getByRole("region", { name: "Chiffres clés" });
  const prefix = mobile ? "fin en" : "Sans dettes en";
  await expect(kpis).toContainText(prefix);
  const match = new RegExp(`${prefix}\\s+(\\S+)\\s+(\\d{4})`).exec(await kpis.innerText());
  if (!match) throw new Error("debt-free month not found");
  return Number(match[2]) * 12 + MONTHS.indexOf(match[1]!);
}

test("adding a loan and raising its principal moves the debt-free month", async ({ page, user }) => {
  await seedPlan(user.client, user.id, addMonths(currentYearMonth(), -1));

  await page.goto("/credits/");
  await page.getByLabel("Nom (facultatif)").fill("Prêt test");
  await page.getByLabel("Capital restant dû (€)").fill("5000");
  await page.getByLabel("TAEG (%)").fill("5");
  await page.getByLabel("Mensualité (€)").fill("200");
  await page.getByRole("button", { name: "Ajouter le crédit" }).click();
  await expect(page.getByText("« Prêt test » a été ajouté.")).toBeVisible();
  const before = await debtFreeIndex(page);

  await page.goto("/credits/");
  await page.getByRole("button", { name: "Modifier « Prêt test »" }).click();
  const principal = page.getByRole("textbox", { name: "Capital restant dû (€)" }).first();
  await principal.fill("20000");
  await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
  await expect(page.getByText("« Prêt test » a été modifié.")).toBeVisible();
  const after = await debtFreeIndex(page);

  expect(after).toBeGreaterThan(before);
});
