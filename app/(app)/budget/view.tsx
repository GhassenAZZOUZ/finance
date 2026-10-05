"use client";

import { PageHeader } from "@/components/app/page-header";
import { useFinance } from "@/components/app/finance-provider";
import { currentYearMonth } from "@/lib/format";
import { useIsMobile } from "@/components/app/use-is-mobile";
import { BudgetForm } from "./budget-form";
import { MobileBudget } from "./mobile-budget";

export function BudgetView() {
  const { snapshot } = useFinance();
  // Phones get grouped lists and a sheet per line (#111); only one layout is mounted.
  if (useIsMobile()) {
    return (
      <MobileBudget
        settings={snapshot.settings}
        lines={snapshot.lines}
        loans={snapshot.loans}
        exceptions={snapshot.exceptions}
        goals={snapshot.goals}
        currentMonth={currentYearMonth()}
      />
    );
  }
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
        goals={snapshot.goals}
        currentMonth={currentYearMonth()}
      />
    </>
  );
}
