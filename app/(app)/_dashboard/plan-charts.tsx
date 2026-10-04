"use client";

/** The dashboard's chart card: one tab per view of the plan (issues #86, #88, #89, #90). */
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { PLAN_GROUP } from "@/components/app/tones";
import type { ComputedPlan } from "@/lib/domain/plan";
import { formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PLAN_CHART_MONTHS,
  debtByLoanSeries,
  debtByLoanSummary,
  goalsTarget,
  interestSeries,
  interestSummary,
  loanBands,
  loanPayoffLines,
  netWorthCrossing,
  netWorthCrossingText,
  netWorthSeries,
  netWorthSummary,
} from "./chart-series";
import { debtSavingsSeries, debtSavingsSummary, fundsSeries, fundsSummary, goalsName } from "./logic";
import { PlanLineChart, type ChartSeries } from "./plan-line-chart";
import { PlanStackChart, type StackSeries } from "./plan-stack-chart";
import { CARD } from "./styles";

type TabId = "debtSavings" | "funds" | "netWorth" | "interest" | "loans";

interface Tab {
  id: TabId;
  label: string;
  render: () => ReactNode;
}

const LOAN_COLORS = ["var(--loan-1)", "var(--loan-2)", "var(--loan-3)", "var(--loan-4)"];

export function PlanCharts({ plan, refIndex }: { plan: ComputedPlan; refIndex: number }) {
  const { months, kpis, loans } = plan.result;
  const { budget } = plan.input;
  const todayLabel = refIndex <= PLAN_CHART_MONTHS ? formatMonthShort(plan.referenceMonth) : undefined;
  const goals = goalsName(kpis);
  const target = goalsTarget(kpis);
  const hasLoans = kpis.hasDebt && loans.length > 0;

  const tabs: Tab[] = [
    {
      id: "debtSavings",
      label: "Dettes et épargne",
      render: () => (
        <PlanLineChart
          data={debtSavingsSeries(months)}
          summary={debtSavingsSummary(months)}
          tableCaption="Dette restante et épargne libre cumulée, par mois"
          todayLabel={todayLabel}
          series={[
            { key: "debt", name: "Dettes", color: PLAN_GROUP.debts.stroke },
            { key: "freeSavings", name: "Épargne libre", color: PLAN_GROUP.remainder.stroke, dashed: true },
          ]}
        />
      ),
    },
  ];

  if (target > 0 || budget.emergencyTarget > 0) {
    const series: ChartSeries[] = [];
    if (target > 0) {
      series.push(
        { key: "moving", name: goals, color: PLAN_GROUP.moving.stroke, marker: "circle" },
        { key: "movingGoal", name: `Objectif ${goals}`, color: PLAN_GROUP.moving.stroke, dashed: true },
      );
    }
    if (budget.emergencyTarget > 0) {
      series.push(
        { key: "emergency", name: "Fonds d’urgence", color: PLAN_GROUP.emergency.stroke, marker: "square" },
        { key: "emergencyTarget", name: "Objectif fonds d’urgence", color: PLAN_GROUP.emergency.stroke, dashed: true },
      );
    }
    tabs.push({
      id: "funds",
      label: "Fonds",
      render: () => (
        <PlanLineChart
          data={fundsSeries(months, target, budget.emergencyTarget, PLAN_CHART_MONTHS)}
          summary={fundsSummary(months, target, budget.emergencyTarget, PLAN_CHART_MONTHS, goals)}
          tableCaption="Objectifs d’épargne et fonds d’urgence face à leurs cibles, par mois"
          todayLabel={todayLabel}
          series={series}
        />
      ),
    });
  }

  tabs.push({
    id: "netWorth",
    label: "Patrimoine",
    render: () => (
      <>
        <p className="text-sm text-muted-foreground">
          Épargne (objectifs, fonds d’urgence, épargne libre) moins dettes. {netWorthCrossingText(netWorthCrossing(months))}
        </p>
        <PlanLineChart
          data={netWorthSeries(months, plan.comparisons)}
          summary={netWorthSummary(months, plan.comparisons)}
          tableCaption="Patrimoine net prévu et réel, par mois"
          todayLabel={todayLabel}
          zeroLine
          series={[
            { key: "actual", name: "Patrimoine réel", color: PLAN_GROUP.emergency.stroke, marker: "circle" },
            { key: "planned", name: "Patrimoine prévu", color: PLAN_GROUP.emergency.stroke, dashed: true, connectGaps: true },
          ]}
        />
      </>
    ),
  });

  if (hasLoans) {
    tabs.push({
      id: "interest",
      label: "Intérêts",
      render: () => (
        <PlanLineChart
          data={interestSeries(months)}
          summary={interestSummary(months)}
          tableCaption="Intérêts cumulés avec et sans le plan, par mois"
          todayLabel={todayLabel}
          series={[
            { key: "withoutPlan", name: "Intérêts sans le plan", color: "var(--bucket-payments-strong)", dashed: true },
            { key: "withPlan", name: "Intérêts avec le plan (pénalités comprises)", color: PLAN_GROUP.debts.stroke },
          ]}
        />
      ),
    });
    const bands = loanBands(loans);
    tabs.push({
      id: "loans",
      label: "Dettes par crédit",
      render: () => {
        const series: StackSeries[] = bands.map((band) => ({
          key: band.key,
          name: band.name,
          color: band.slot === null ? "var(--bucket-payments)" : LOAN_COLORS[band.slot]!,
          type: "area",
          stackId: "loans",
        }));
        series.push({ key: "baseline", name: "Total sans le plan", color: "var(--bucket-payments-strong)", type: "line", dashed: true });
        return (
          <>
            <PlanStackChart
              data={debtByLoanSeries(months, bands)}
              series={series}
              summary={debtByLoanSummary(months, loans)}
              tableCaption="Dette restante par crédit, et total sans le plan, par mois"
            />
            <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground" aria-label="Fin des crédits">
              {loanPayoffLines(loans, bands).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        );
      },
    });
  }

  return <ChartTabs tabs={tabs} />;
}

/** WAI-ARIA tabs: arrow keys, Home and End move between tabs (automatic activation). */
function ChartTabs({ tabs }: { tabs: Tab[] }) {
  const [selected, setSelected] = useState<TabId>(tabs[0]!.id);
  const active = tabs.find((t) => t.id === selected) ?? tabs[0]!;
  const base = useId();
  const refs = useRef(new Map<TabId, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active.id);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next]!;
    setSelected(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  return (
    <section aria-labelledby={`${base}-title`} className={cn(CARD, "flex min-w-0 flex-col gap-4")}>
      <h2 id={`${base}-title`} className="text-base font-semibold md:text-[17px]">
        Évolution du plan, {PLAN_CHART_MONTHS} mois
      </h2>
      <div role="tablist" aria-label="Graphiques du plan" onKeyDown={onKeyDown} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`${base}-panel`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active.id}`} className="flex min-w-0 flex-col gap-3">
        {active.render()}
      </div>
    </section>
  );
}
