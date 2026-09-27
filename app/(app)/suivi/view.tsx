"use client";

import { CalendarClock } from "lucide-react";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFinance } from "@/components/app/finance-provider";
import { planRebase } from "@/lib/domain/rebase";
import type { ActualForm } from "@/lib/domain/validation";
import { compareMonths } from "@/lib/engine";
import { currentYearMonth, formatMonthLong } from "@/lib/format";
import { CheckInForm } from "./check-in-form";
import { History } from "./history";
import { type PlannedValues, buildHistory, checkInMonths, plannedForMonth, prefillForm } from "./logic";
import { RebaseCard } from "./rebase-card";

const TITLE = "Suivi mensuel";
const DESCRIPTION = "Chaque mois, reportez vos soldes réels pour comparer avec le plan.";

export function SuiviView() {
  const { snapshot, plan } = useFinance();

  if (!plan || !snapshot.settings) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <Onboarding hasBudget={snapshot.settings !== null} loanCount={snapshot.loans.length} />
      </>
    );
  }

  const { startMonth } = snapshot.settings;
  const currentMonth = currentYearMonth();
  // After "Recaler le plan" the start month can be next month: the history stays visible.
  const notStarted = compareMonths(startMonth, currentMonth) > 0;
  const hasActuals = snapshot.actuals.length > 0;

  const months = notStarted ? [] : checkInMonths(startMonth, currentMonth);
  const actualsByMonth = new Map(snapshot.actuals.map((a) => [a.month, a]));
  const values: Record<string, ActualForm> = {};
  const planned: Record<string, PlannedValues | null> = {};
  for (const month of months) {
    values[month] = prefillForm(month, actualsByMonth.get(month), snapshot.loans);
    planned[month] = plannedForMonth(plan.result, startMonth, month);
  }
  const loans = snapshot.loans.map((loan, j) => ({
    id: loan.id,
    label: plan.result.loans[j]?.displayName ?? loan.name ?? `Crédit ${j + 1}`,
  }));
  const loanLabels = Object.fromEntries(loans.map((l) => [l.id, l.label]));

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />

      <div className="flex flex-col gap-8">
        {notStarted ? (
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock aria-hidden className="size-5 shrink-0" />
                <h2>Le suivi n’a pas encore commencé</h2>
              </CardTitle>
              <CardDescription>
                Votre plan démarre en {formatMonthLong(startMonth)}. Les saisies mensuelles seront possibles à partir de ce
                mois-là.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card className="w-full max-w-xl overflow-visible">
            <CardHeader>
              <CardTitle>
                <h2>Saisie du mois</h2>
              </CardTitle>
              <CardDescription>Soldes relevés en fin de mois sur vos comptes et relevés de crédit.</CardDescription>
            </CardHeader>
            <CardContent>
              <CheckInForm
                key={startMonth}
                months={months}
                values={values}
                existing={snapshot.actuals.map((a) => a.month)}
                planned={planned}
                loans={loans}
              />
            </CardContent>
          </Card>
        )}

        <RebaseCard preview={planRebase(snapshot, plan)} startMonth={startMonth} loanLabels={loanLabels} />

        {notStarted && !hasActuals ? null : (
          <section aria-labelledby="suivi-history-title" className="flex min-w-0 flex-col gap-4">
            <h2 id="suivi-history-title" className="text-lg font-semibold">
              Historique
            </h2>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Écart dettes : vert si ≤ prévu (+10 € de tolérance). Écart épargne : vert si ≥ prévu (−10 € de tolérance).
              Statut : les deux verts → Dans les temps ; les deux rouges → En retard ; sinon Mitigé.
            </p>
            <History entries={buildHistory(plan.comparisons, snapshot.actuals)} />
          </section>
        )}
      </div>
    </>
  );
}
