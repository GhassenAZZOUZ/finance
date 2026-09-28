/** Issue #10: add a savings goal; the dashboard shows it and the check-in asks for its balance. */
import { addMonths } from "../lib/engine";
import { currentYearMonth } from "../lib/format";
import { expect, seedPlan, test } from "./fixtures";

test("adds a savings goal and uses it on the dashboard and in the check-in", async ({ page, user }) => {
  await seedPlan(user.client, user.id, addMonths(currentYearMonth(), -1));

  await page.goto("/budget/");
  const card = page.getByRole("group", { name: "Objectifs d’épargne" });
  const form = card.getByRole("form", { name: "Ajouter un objectif" });
  await form.getByLabel("Nom de l’objectif").fill("Voiture");
  await form.getByLabel("Montant visé (€)").fill("8000");
  await form.getByLabel("Date limite (AAAA-MM)").fill(addMonths(currentYearMonth(), 24));
  await form.getByLabel("Déjà épargné (€)").fill("500");
  await form.getByRole("button", { name: "Ajouter l’objectif" }).click();
  await expect(card.getByRole("status")).toContainText("« Voiture » a été ajouté.");
  await expect(card.getByRole("heading", { name: /Priorité 2 : Voiture/ })).toBeVisible();

  await page.goto("/");
  const goals = page.getByRole("region", { name: "Objectifs d’épargne" });
  await expect(goals).toContainText("Voiture");

  await page.goto("/suivi/");
  await expect(page.getByRole("textbox", { name: "Épargne voiture" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Épargne déménagement" })).toBeVisible();
});
