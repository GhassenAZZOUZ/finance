"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFinance } from "@/components/app/finance-provider";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { useIsMobile } from "@/components/app/use-is-mobile";
import { PHASE_STYLE } from "@/components/app/tones";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ComputedPlan } from "@/lib/domain/plan";
import { HORIZON_MONTHS, monthsBetween } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type PlanPhase, goalsName, goalsPhrase, phaseLabel, planPhases, primaryGoalName } from "../_dashboard/logic";
import { exceptionsByPlanIndex } from "./exceptions";
import { ROW_COUNTS, findMilestones, parseRowCount } from "./milestones";
import { MobilePlan } from "./mobile-plan";
import { PlanTable } from "./plan-table";

const TITLE = "Plan mois par mois";

export function PlanView() {
  const { snapshot, plan } = useFinance();
  const rowCount = parseRowCount(useSearchParams().get("mois"));
  const isMobile = useIsMobile();
  if (!plan) {
    return (
      <>
        <PageHeader title={TITLE} />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }

  const milestones = findMilestones(plan.input, plan.result);
  const months = plan.result.months.slice(0, rowCount);
  const exceptions = exceptionsByPlanIndex(snapshot.exceptions, plan.input.budget.startMonth, plan.result.months.length);
  const phases = planPhases(plan.result.months);
  const todayIndex = monthsBetween(plan.input.budget.startMonth, plan.referenceMonth) + 1;
  const next = ROW_COUNTS.find((r) => r.count > rowCount);
  const negativeAlert =
    milestones.negativeCount > 0 && milestones.firstNegativeMonth ? (
      <Alert variant="destructive" className="rounded-2xl border-bad-border bg-bad-bg text-bad">
        <TriangleAlert aria-hidden />
        <AlertTitle>
          {milestones.negativeCount} mois en budget négatif (premier : {formatMonthLong(milestones.firstNegativeMonth)})
        </AlertTitle>
        <AlertDescription className="text-bad">Vos dépenses dépassent vos revenus : ces mois-là rien n’est épargné.</AlertDescription>
      </Alert>
    ) : null;

  // Phones get month cards instead of the wide table (#113).
  if (isMobile) {
    return (
      <>
        {negativeAlert}
        <MobilePlan plan={plan} months={months} rowCount={rowCount} milestones={milestones} phases={phases} todayIndex={todayIndex} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={TITLE}
        description={`Chaque mois, le disponible remplit ① ${goalsPhrase(plan.result.kpis)}, ② le fonds d’urgence, puis ③ se partage entre remboursement anticipé et épargne libre. Pour changer le résultat, modifiez le budget, les objectifs ou les crédits.`}
        actions={<RangeControl rowCount={rowCount} />}
      />

      {negativeAlert}

      <Overview plan={plan} phases={phases} rowCount={rowCount} negativeCount={milestones.negativeCount} />

      <section aria-label="Tableau du plan" className="overflow-hidden rounded-2xl border bg-card">
        <PlanTable
          months={months}
          milestones={milestones}
          exceptions={exceptions}
          phases={phases}
          todayIndex={todayIndex}
          earlyRepaymentPct={plan.input.budget.earlyRepaymentPct}
          movingGoalMet={plan.result.kpis.movingGoalMet}
          goalsName={goalsName(plan.result.kpis)}
          primaryName={primaryGoalName(plan.result.kpis)}
          caption={`Plan mois par mois, ${months.length} mois à partir de ${formatMonthLong(plan.input.budget.startMonth)}, montants en euros`}
        />
        {next ? (
          <div className="flex justify-center border-t border-divider p-3.5">
            <Link
              href={`/plan?mois=${next.count}`}
              scroll={false}
              className="inline-flex min-h-11 items-center rounded-[10px] border border-input bg-card px-4.5 text-sm font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Afficher {next.count === HORIZON_MONTHS ? "les 25 ans" : next.label}
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}

/**
 * 1 mois … 25 ans, kept in the URL (`?mois=`). Seven choices do not fit a phone's width: a select
 * there, the segmented links from `sm` (issue #76).
 */
function RangeControl({ rowCount }: { rowCount: number }) {
  const router = useRouter();
  return (
    <>
      <label className="flex items-center gap-2 text-sm font-medium sm:hidden">
        Période affichée
        <select
          value={rowCount}
          onChange={(e) => router.replace(`/plan?mois=${e.target.value}`, { scroll: false })}
          className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
        >
          {ROW_COUNTS.map((r) => (
            <option key={r.count} value={r.count}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <RangeLinks rowCount={rowCount} />
    </>
  );
}

function RangeLinks({ rowCount }: { rowCount: number }) {
  return (
    <nav aria-label="Période affichée" className="hidden overflow-hidden rounded-[10px] border border-input bg-card sm:inline-flex">
      {ROW_COUNTS.map((r) => {
        const active = r.count === rowCount;
        return (
          <Link
            key={r.count}
            href={`/plan?mois=${r.count}`}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex min-h-11 items-center px-3.5 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-secondary",
            )}
          >
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Les 300 mois du plan": phases proportional to their length, with a bracket around the rows shown. */
function Overview({
  plan,
  phases,
  rowCount,
  negativeCount,
}: {
  plan: ComputedPlan;
  phases: PlanPhase[];
  rowCount: number;
  negativeCount: number;
}) {
  const { months } = plan.result;
  const total = months.length;
  const pct = plan.input.budget.earlyRepaymentPct;
  const first = months[0];
  const last = months.at(-1);
  const length = (p: PlanPhase) => p.endIndex - p.startIndex + 1;
  const summary = phases.map((p) => `${phaseLabel(p.kind, pct, goalsName(plan.result.kpis))} ${length(p)} mois`).join(", ");
  return (
    <section aria-labelledby="ov-title" className="flex flex-col gap-3 rounded-2xl border bg-card px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ov-title" className="text-[15px] font-semibold">
          Les {total} mois du plan
        </h2>
        {first && last ? (
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {formatMonthShort(first.month)} → {formatMonthShort(last.month)}
          </span>
        ) : null}
      </div>
      <div role="img" aria-label={`${summary}. ${rowCount === 1 ? "Le premier mois est affiché" : `Les ${rowCount} premiers mois sont affichés`} ci-dessous.`} className="relative flex h-8.5 gap-0.5">
        {phases.map((p, i) => {
          const width = (length(p) / total) * 100;
          const free = months[p.startIndex - 1]?.toFreeSavings ?? 0;
          return (
            <div
              key={`${p.kind}-${p.startIndex}`}
              className={cn(
                "flex min-w-1 items-center overflow-hidden rounded-[2px] text-[13px] font-medium whitespace-nowrap",
                PHASE_STYLE[p.kind].band,
                i === 0 && "rounded-l-md",
                i === phases.length - 1 && "rounded-r-md",
              )}
              style={{ width: `${width}%` }}
            >
              {width >= 30 ? (
                <span aria-hidden className="truncate px-3.5">
                  {phaseLabel(p.kind, pct, goalsName(plan.result.kpis))}
                  {p.kind === "free" && free > 0 ? ` · ${formatEuros(free)} par mois à partir de ${formatMonthLong(p.startMonth)}` : ""}
                </span>
              ) : null}
            </div>
          );
        })}
        <div
          aria-hidden
          className="absolute -top-1.5 -bottom-1.5 -left-1 rounded-lg border-2 border-foreground"
          style={{ width: `calc(${(Math.min(rowCount, total) / total) * 100}% + 4px)` }}
        />
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground tabular-nums">
        {phases
          .filter((p) => p.kind !== "free" || phases.length === 1)
          .map((p) => (
            <li key={`${p.kind}-${p.startIndex}`} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-[3px]", PHASE_STYLE[p.kind].swatch)} />
              {phaseLabel(p.kind, pct, goalsName(plan.result.kpis))} · {length(p)} mois
            </li>
          ))}
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3.5 rounded-[3px] border-2 border-foreground" />
          Mois affichés ci-dessous
        </li>
        <li className={cn("font-medium sm:ml-auto", negativeCount > 0 ? "text-bad" : "text-good")}>
          {negativeCount} mois en budget négatif
        </li>
      </ul>
    </section>
  );
}
