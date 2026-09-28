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
  await page.getByRole("textbox", { name: "Épargne déménagement" }).fill("1000");
  await page.getByRole("textbox", { name: "Fonds d’urgence" }).fill("1000");
  await page.getByRole("textbox", { name: "Épargne libre" }).fill("0");
  await page.getByRole("textbox", { name: "Prêt test" }).fill("5000");
  await page.getByRole("button", { name: `Enregistrer ${formatMonthLong(month)}` }).click();

  const history = page.getByRole("region", { name: "Historique" });
  const entry = history.getByRole("listitem").filter({ hasText: formatMonthLong(month) });
  // Debt above the plan and savings below it: "En retard".
  await expect(entry).toContainText("En retard");
});
