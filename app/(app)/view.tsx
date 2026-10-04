"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { checkInHref, usePendingCheckIns } from "@/components/app/nav";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import type { ComputedPlan } from "@/lib/domain/plan";
import { HORIZON_MONTHS, type YearMonth, monthsBetween } from "@/lib/engine";
import { currentYearMonth, formatMonthLong } from "@/lib/format";
import {
  checkInStrip,
  dashboardHeadline,
  goalsName,
  primaryGoalName,
  movingShortfallOptions,
} from "./_dashboard/logic";
import { PlanCharts } from "./_dashboard/plan-charts";
import { IncomeUses } from "./_dashboard/income-uses";
import { CheckInCharts } from "./_dashboard/check-in-charts";
import { NegativeBudgetNotice, MovingAlert } from "./_dashboard/notices";
import { MarginTile, DebtTile, SavingsTile } from "./_dashboard/tiles";
import { Roadmap } from "./_dashboard/roadmap";
import { Goals } from "./_dashboard/goals";
import { verdictOf } from "@/lib/domain/verdict";
import { CheckInStripCard } from "./_dashboard/check-in-strip";
import { RepaymentOrder } from "./_dashboard/repayment-order";

export function DashboardView() {
  const { snapshot, plan } = useFinance();
  const pending = usePendingCheckIns();
  if (!plan) {
    return (
      <>
        <PageHeader title="Tableau de bord" />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }
  return <Dashboard plan={plan} pending={pending} />;
}

function Dashboard({ plan, pending }: { plan: ComputedPlan; pending: YearMonth[] }) {
  const { kpis, months } = plan.result;
  const { budget } = plan.input;
  const refIndex = monthsBetween(budget.startMonth, plan.referenceMonth) + 1;
  const ref = months[refIndex - 1]!;
  const oldestPending = pending[0];
  const shortfall = useMemo(
    () => movingShortfallOptions(plan.input, plan.result, plan.referenceMonth),
    [plan.input, plan.result, plan.referenceMonth],
  );

  return (
    <>
      <PageHeader
        eyebrow={`${formatMonthLong(plan.referenceMonth)} · mois ${refIndex} sur ${HORIZON_MONTHS}`}
        title={dashboardHeadline(kpis)}
        actions={
          <>
            <Button asChild variant="outline" className="min-h-11 px-4.5 text-[15px]">
              <Link href="/plan">Voir le plan</Link>
            </Button>
            {oldestPending ? (
              <Button asChild className="min-h-11 px-4.5 text-[15px]">
                <Link href={checkInHref(oldestPending)}>Saisir {formatMonthLong(oldestPending)}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <NegativeBudgetNotice count={kpis.negativeBudgetMonths} />

      <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-2.5 md:gap-4 xl:grid-cols-3">
        <MarginTile kpis={kpis} month={plan.referenceMonth} />
        <DebtTile plan={plan} current={ref} />
        <SavingsTile
          current={ref}
          in12={months[refIndex - 1 + 12]}
          goalsLabel={goalsName(kpis)}
          interest={kpis.savingsInterest > 0 ? { at12: kpis.savingsInterestAt12, total: kpis.savingsInterest } : undefined}
          className="col-span-2 xl:col-span-1"
        />
      </section>

      {shortfall ? <MovingAlert shortfall={shortfall} referenceMonth={plan.referenceMonth} goalName={primaryGoalName(kpis)} /> : null}

      <Roadmap plan={plan} refIndex={refIndex} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <PlanCharts plan={plan} refIndex={refIndex} />
        <Goals plan={plan} current={ref} in12={months[refIndex - 1 + 12]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CheckInStripCard
          slots={checkInStrip(budget.startMonth, currentYearMonth(), plan.comparisons)}
          startMonth={budget.startMonth}
          verdicts={Object.fromEntries(plan.actuals.map((a) => [a.month, verdictOf(a)]))}
        />
        <RepaymentOrder plan={plan} />
      </div>

      <IncomeUses plan={plan} refIndex={refIndex} />

      <CheckInCharts plan={plan} firstCheckInHref={oldestPending ? checkInHref(oldestPending) : "/suivi"} />
    </>
  );
}
