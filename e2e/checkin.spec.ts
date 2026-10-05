/** AC-04: a monthly check-in is saved and its status shows in the history. */
import { addMonths } from "../lib/engine";
import { currentYearMonth, formatMonthLong } from "../lib/format";
import { expect, seedPlan, test } from "./fixtures";

test("saves a check-in and shows its status", async ({ page, user }) => {
  const month = addMonths(currentYearMonth(), -2);
  await seedPlan(user.client, user.id, month);
  const loan = await user.client
    .from("loans")
    .insert({ user_id: user.id, name: "Prêt test", principal: 5000, apr: 0.05, monthly_payment: 200, position: 0 })
    .select("id")
    .single();
  if (loan.error) throw loan.error;

  await page.goto(`/suivi/?mois=${month}`);
  if (test.info().project.name === "mobile") {
    // Phones: the full-screen flow in 4 steps (#110), same values, one save at the end.
    await page.getByRole("button", { name: "Tout est comme prévu" }).click();
    await page.getByRole("textbox", { name: "Courses" }).fill("520");
    await page.getByRole("button", { name: "Suivant : épargne" }).click();
    await page.getByRole("textbox", { name: "Épargne déménagement" }).fill("0");
    await page.getByRole("textbox", { name: "Fonds d’urgence" }).fill("0");
    await page.getByRole("textbox", { name: "Épargne libre" }).fill("0");
    await page.getByRole("button", { name: "Suivant : crédits" }).click();
    await page.getByRole("textbox", { name: "Prêt test" }).fill("5000");
    await page.getByRole("button", { name: "Suivant : vérifier" }).click();
    await page.getByRole("button", { name: `Enregistrer ${formatMonthLong(month)}` }).click();
    await expect(page.getByText(`Mois de ${formatMonthLong(month)} enregistré.`)).toBeVisible();
    await page.getByRole("button", { name: "Terminer" }).click();
  } else {
    // Income and expenses line by line (#72): the budget, then more spent on groceries.
    for (const group of ["Revenus", "Charges fixes", "Dépenses variables"]) {
      await page.getByRole("button", { name: `Tout comme prévu : ${group}` }).click();
    }
    await page.getByRole("textbox", { name: "Courses" }).fill("520");
    // Savings are this month's deposits (#73): nothing put aside, so savings fall below the plan.
    await expect(page.getByText("Épargne versée ce mois")).toBeVisible();
    await page.getByRole("textbox", { name: "Épargne déménagement" }).fill("0");
    await page.getByRole("textbox", { name: "Fonds d’urgence" }).fill("0");
    await page.getByRole("textbox", { name: "Épargne libre" }).fill("0");
    await page.getByRole("textbox", { name: "Prêt test" }).fill("5000");
    await page.getByRole("button", { name: `Enregistrer ${formatMonthLong(month)}` }).click();
  }

  const history = page.getByRole("region", { name: "Historique" });
  const entry = history.getByRole("listitem").filter({ hasText: formatMonthLong(month) });
  // The month's verdict (#74): income as planned, groceries over budget, nothing saved.
  await expect(entry).toContainText("Plan partiellement tenu");
  // Its trajectory: debt above the plan and savings below it, "En retard".
  await expect(entry).toContainText("en retard");
  // The rows are kept with the check-in: groceries over budget (#72).
  const lines = page.getByRole("region", { name: "Réel vs budget par ligne" });
  await expect(lines.getByRole("row", { name: /Courses/ })).toContainText("dépassement");
});
