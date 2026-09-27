import { PageHeader } from "@/components/app/page-header";
import { loadPageData } from "@/lib/data/session";
import { currentYearMonth } from "@/lib/format";
import { BudgetForm } from "./budget-form";

export default async function BudgetPage() {
  const { snapshot } = await loadPageData();
  return (
    <>
      <PageHeader
        title="Budget"
        description="Revenus, charges et paramètres du plan. L’aperçu se met à jour pendant la saisie."
      />
      <BudgetForm
        settings={snapshot.settings}
        lines={snapshot.lines}
        loans={snapshot.loans}
        currentMonth={currentYearMonth()}
      />
    </>
  );
}
