"use client";

import { PageHeader } from "@/components/app/page-header";
import { useFinance } from "@/components/app/finance-provider";
import { currentYearMonth } from "@/lib/format";
import { BudgetForm } from "./budget-form";

export function BudgetView() {
  const { snapshot } = useFinance();
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
        exceptions={snapshot.exceptions}
        currentMonth={currentYearMonth()}
      />
    </>
  );
}
