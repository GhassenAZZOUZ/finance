/** AC-02: add and edit budget lines; the Budget totals and the dashboard KPI follow. */
import { currentYearMonth } from "../lib/format";
import { expect, test } from "./fixtures";

/** Matches French-formatted text whatever the kind of space (fr-FR uses narrow no-break spaces). */
const euros = (text: string) => new RegExp(text.split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s"));

test("adds and edits budget lines, then the dashboard margin reflects them", async ({ page, user }) => {
  void user;
  await page.goto("/budget/");
  if (test.info().project.name === "mobile") {
    // Phones (#111): the parameters first (« Objectifs » tab on a first visit), then one sheet per line.
    await page.getByRole("textbox", { name: "Début du plan" }).fill(currentYearMonth());
    await page.getByRole("textbox", { name: "Taux seuil (%)" }).fill("3");
    await page.getByRole("textbox", { name: "Part du reste en remboursement anticipé" }).fill("50");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("✓ Budget enregistré.")).toBeVisible();

    await page.getByRole("tab", { name: "Mois type" }).click();
    const addLine = async (button: string, label: string, amount: string) => {
      await page.getByRole("button", { name: button }).click();
      const sheet = page.getByRole("dialog", { name: button });
      await sheet.getByLabel("Montant mensuel (€)").fill(amount);
      await sheet.getByLabel("Libellé").fill(label);
      await sheet.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByRole("status").filter({ hasText: `« ${label} » a été ajoutée.` })).toBeVisible();
    };
    await addLine("Ajouter un revenu", "Salaire test", "3000");
    await addLine("Ajouter une charge", "Loyer test", "900");
    const fixedGroup = page.getByRole("group", { name: /^Charges fixes/ });
    await expect(fixedGroup.getByRole("heading")).toContainText(euros("900,00 €"));

    // Edit after a reload: tap the line, change its amount, save the sheet.
    await page.reload();
    await fixedGroup.getByRole("button", { name: /Loyer test/ }).click();
    const sheet = page.getByRole("dialog", { name: "Modifier « Loyer test »" });
    await sheet.getByLabel("Montant mensuel (€)").fill("1000");
    await sheet.getByRole("button", { name: "Enregistrer" }).click();
    await expect(sheet).toBeHidden();
    await expect(fixedGroup.getByRole("heading")).toContainText(euros("1 000,00 €"));
  } else {
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
  }

  await page.goto("/");
  if (test.info().project.name === "mobile") {
    // Phones get the mobile home (#109): the dark margin card, and no sideways page scroll.
    const margin = page.getByRole("region", { name: "Marge du mois" });
    await expect(margin).toContainText(euros("2 000,00 €"));
    await expect(margin).toContainText(euros("3 000 €revenus"));
    await expect(margin).toContainText(euros("1 000 €dépenses"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    return;
  }
  const kpis = page.getByRole("region", { name: "Chiffres clés" });
  await expect(kpis.getByRole("heading", { name: /^Marge mensuelle/ })).toBeVisible();
  await expect(kpis).toContainText(euros("2 000,00 €"));
  await expect(kpis).toContainText(euros("3 000,00 € revenus − 1 000,00 € dépenses"));
});
