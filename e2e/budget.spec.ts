/** AC-02: add and edit budget lines; the Budget totals and the dashboard KPI follow. */
import { currentYearMonth } from "../lib/format";
import { expect, test } from "./fixtures";

/** Matches French-formatted text whatever the kind of space (fr-FR uses narrow no-break spaces). */
const euros = (text: string) => new RegExp(text.split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s"));

test("adds and edits budget lines, then the dashboard margin reflects them", async ({ page, user }) => {
  void user;
  await page.goto("/budget/");
  const income = page.getByRole("group", { name: "Revenus nets mensuels" });
  const fixed = page.getByRole("group", { name: /^Charges fixes/ });

  await income.getByRole("button", { name: "Ajouter un revenu" }).click();
  await income.getByRole("textbox", { name: /^Libellé/ }).last().fill("Salaire test");
  await income.getByRole("textbox", { name: /^Montant mensuel/ }).last().fill("3000");
  await fixed.getByRole("button", { name: "Ajouter une charge" }).click();
  await fixed.getByRole("textbox", { name: /^Libellé/ }).last().fill("Loyer test");
  await fixed.getByRole("textbox", { name: /^Montant mensuel/ }).last().fill("900");

  const start = currentYearMonth();
  await page.getByRole("textbox", { name: "Début du plan" }).fill(start);
  await page.getByRole("textbox", { name: "Taux seuil (%)" }).fill("3");
  await page.getByRole("textbox", { name: "Part du reste en remboursement anticipé" }).fill("50");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("✓ Budget enregistré.")).toBeVisible();

  await expect(income).toContainText(euros("Total : 3 000,00 €"));
  await expect(fixed).toContainText(euros("Total : 900,00 €"));

  // Edit after a reload (the saved lines come back from the database): the rent goes up by 100 €.
  await page.reload();
  await expect(fixed).toContainText(euros("Total : 900,00 €"));
  await fixed.getByRole("textbox", { name: /^Montant mensuel.*Loyer test/ }).fill("1000");
  await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("✓ Budget enregistré.")).toBeVisible();
  await expect(fixed).toContainText(euros("Total : 1 000,00 €"));

  await page.goto("/");
  const kpis = page.getByRole("region", { name: "Chiffres clés" });
  await expect(kpis.getByRole("heading", { name: /^Marge mensuelle/ })).toBeVisible();
  await expect(kpis).toContainText(euros("2 000,00 €"));
  await expect(kpis).toContainText(euros("3 000,00 € revenus − 1 000,00 € dépenses"));
});
