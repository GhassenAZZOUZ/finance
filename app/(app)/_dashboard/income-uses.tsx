"use client";

/** Where each month's income goes, 12 months from the reference month (issue #87). */
import { PLAN_GROUP } from "@/components/app/tones";
import type { ComputedPlan } from "@/lib/domain/plan";
import { cn } from "@/lib/utils";
import { incomeUsesSeries, incomeUsesSummary } from "./chart-series";
import { goalsName } from "./logic";
import { PlanStackChart, type StackSeries } from "./plan-stack-chart";
import { CARD } from "./styles";

const MONTHS = 12;

export function IncomeUses({ plan, refIndex }: { plan: ComputedPlan; refIndex: number }) {
  const { months, kpis } = plan.result;
  const data = incomeUsesSeries(months, refIndex - 1, MONTHS);
  if (data.length === 0) return null;
  const has = (key: keyof (typeof data)[number]) => data.some((p) => p[key] !== 0);
  const segments: StackSeries[] = [
    { key: "expenses", name: "Dépenses", color: "var(--bucket-expenses)", type: "bar", stackId: "uses" },
    { key: "loanPayments", name: "Mensualités", color: "var(--bucket-payments)", type: "bar", stackId: "uses" },
    { key: "goals", name: goalsName(kpis), color: PLAN_GROUP.moving.stroke, type: "bar", stackId: "uses" },
    { key: "emergency", name: "Fonds d’urgence", color: PLAN_GROUP.emergency.stroke, type: "bar", stackId: "uses" },
    { key: "earlyRepayment", name: "Remboursement anticipé", color: PLAN_GROUP.debts.stroke, type: "bar", stackId: "uses" },
    { key: "freeSavings", name: "Épargne libre", color: "var(--bucket-remainder)", type: "bar", stackId: "uses" },
    { key: "shortfall", name: "Budget négatif", color: "var(--bad)", type: "bar", stackId: "uses" },
  ];
  const series: StackSeries[] = [
    ...segments.filter((s) => has(s.key as keyof (typeof data)[number])),
    { key: "income", name: "Revenus", color: "var(--foreground)", type: "bar", tooltipOnly: true },
  ];
  return (
    <section aria-labelledby="income-uses-title" className={cn(CARD, "flex min-w-0 flex-col gap-4")}>
      <div className="flex flex-col gap-1">
        <h2 id="income-uses-title" className="text-base font-semibold md:text-[17px]">
          Où vont vos revenus, {MONTHS} mois
        </h2>
        <p className="text-sm text-muted-foreground">
          Chaque barre fait le total des revenus du mois. Quand un crédit se termine, sa mensualité passe à l’épargne.
        </p>
      </div>
      <PlanStackChart
        data={data}
        series={series}
        summary={incomeUsesSummary(months, refIndex - 1, MONTHS)}
        tableCaption="Répartition des revenus, par mois"
        zeroLine={has("shortfall")}
      />
    </section>
  );
}
