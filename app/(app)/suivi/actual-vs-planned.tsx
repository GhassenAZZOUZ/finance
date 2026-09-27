"use client";

import { PLAN_GROUP } from "@/components/app/tones";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActualComparison } from "@/lib/engine";
import { actualVsPlannedSeries, actualVsPlannedSummary } from "../_dashboard/logic";
import { PlanLineChart } from "../_dashboard/plan-line-chart";

/** Issue #4: real debt and savings (check-ins) against the plan, month by month (moved from the dashboard). */
export function ActualVsPlannedCard({ comparisons }: { comparisons: readonly ActualComparison[] }) {
  const points = actualVsPlannedSeries(comparisons);
  if (points.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Réel et prévu, mois après mois</h2>
        </CardTitle>
        <CardDescription>
          Vos soldes saisis (traits pleins, points pleins) face au plan (pointillés, points creux). Un mois sans saisie
          laisse un trou dans la ligne réelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="avp-debt-title" className="flex min-w-0 flex-col gap-2">
          <h3 id="avp-debt-title" className="text-sm font-medium">
            Dettes restantes
          </h3>
          <PlanLineChart
            data={points}
            summary={actualVsPlannedSummary(comparisons, "debt")}
            tableCaption="Dettes réelles et prévues, par mois de suivi"
            series={[
              { key: "actualDebt", name: "Dettes réelles", color: PLAN_GROUP.debts.stroke, marker: "circle" },
              { key: "plannedDebt", name: "Dettes prévues", color: PLAN_GROUP.debts.stroke, dashed: true, marker: "ring", connectGaps: true },
            ]}
          />
        </section>
        <section aria-labelledby="avp-savings-title" className="flex min-w-0 flex-col gap-2">
          <h3 id="avp-savings-title" className="text-sm font-medium">
            Épargne totale (déménagement + urgence + libre)
          </h3>
          <PlanLineChart
            data={points}
            summary={actualVsPlannedSummary(comparisons, "savings")}
            tableCaption="Épargne réelle et prévue, par mois de suivi"
            series={[
              { key: "actualSavings", name: "Épargne réelle", color: PLAN_GROUP.remainder.stroke, marker: "square" },
              { key: "plannedSavings", name: "Épargne prévue", color: PLAN_GROUP.remainder.stroke, dashed: true, marker: "ring", connectGaps: true },
            ]}
          />
        </section>
      </CardContent>
    </Card>
  );
}
