"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { ArrowLink, checkInHref, usePendingCheckIns } from "@/components/app/nav";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { PHASE_STYLE, PLAN_GROUP, STATUS_TONE } from "@/components/app/tones";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ComputedPlan } from "@/lib/domain/plan";
import { HORIZON_MONTHS, type PlanKpis, type PlanMonth, type YearMonth, monthsBetween } from "@/lib/engine";
import { currentYearMonth, formatEuros, formatEurosWhole, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DEBT_ALERT_LABEL, STATUS_LABEL, debtFreeText } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { GoalMeter, SegmentBar, StatTile, type Tone, ToneText } from "./_dashboard/kpi";
import {
  type CheckInSlot,
  type MovingShortfall,
  type PlanPhase,
  type RoadmapEvent,
  checkInStrip,
  dashboardHeadline,
  debtSavingsSeries,
  debtSavingsSummary,
  formatSignedEuros,
  monthsGained,
  goalsName,
  phaseLabel,
  primaryGoalName,
  movingShortfallOptions,
  planPhases,
  roadmapEvents,
  roadmapWindow,
} from "./_dashboard/logic";
import { PlanLineChart } from "./_dashboard/plan-line-chart";

const DEBT_ALERT_TONE: Record<PlanKpis["debtAlert"], Tone> = { ok: "good", warning: "warning", alert: "bad" };

const CARD = "rounded-2xl border bg-card p-4 md:p-6";

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
          className="col-span-2 xl:col-span-1"
        />
      </section>

      {shortfall ? <MovingAlert shortfall={shortfall} referenceMonth={plan.referenceMonth} goalName={primaryGoalName(kpis)} /> : null}

      <Roadmap plan={plan} refIndex={refIndex} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section aria-labelledby="chart-title" className={cn(CARD, "flex min-w-0 flex-col gap-4")}>
          <h2 id="chart-title" className="text-base font-semibold md:text-[17px]">
            Dettes et épargne libre, 24 mois
          </h2>
          <PlanLineChart
            data={debtSavingsSeries(months)}
            summary={debtSavingsSummary(months)}
            tableCaption="Dette restante et épargne libre cumulée, par mois"
            todayLabel={refIndex <= 24 ? formatMonthShort(plan.referenceMonth) : undefined}
            series={[
              { key: "debt", name: "Dettes", color: PLAN_GROUP.debts.stroke },
              { key: "freeSavings", name: "Épargne libre", color: PLAN_GROUP.remainder.stroke, dashed: true },
            ]}
          />
        </section>
        <Goals plan={plan} current={ref} in12={months[refIndex - 1 + 12]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CheckInStripCard slots={checkInStrip(budget.startMonth, currentYearMonth(), plan.comparisons)} startMonth={budget.startMonth} />
        <RepaymentOrder plan={plan} />
      </div>
    </>
  );
}

function NegativeBudgetNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Alert variant="destructive" className="rounded-2xl border-bad-border bg-bad-bg px-4 py-3">
      <CircleAlert aria-hidden />
      <AlertTitle className="text-bad">{count} mois en budget négatif</AlertTitle>
      <AlertDescription className="text-bad">
        Ces mois-là, revenus moins dépenses et mensualités sont négatifs : rien n’est épargné.{" "}
        <Link href="/plan?mois=300" className="font-medium underline underline-offset-4">
          Voir le plan mois par mois
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/* ---------------------------------------------------------------------------------- Stat tiles */

function MarginTile({ kpis, month }: { kpis: PlanKpis; month: YearMonth }) {
  const income = kpis.monthlyIncome;
  const share = (cents: number) => (income > 0 ? Math.max(0, cents) / income : 0);
  const negative = kpis.margin < 0;
  return (
    <StatTile
      label={`Marge mensuelle · ${formatMonthShort(month)}`}
      value={<span className={negative ? "text-bad" : undefined}>{formatEuros(kpis.margin)}</span>}
      visual={
        <SegmentBar
          track="bg-secondary"
          segments={[
            { key: "expenses", fraction: share(kpis.monthlyExpenses), className: "bg-bucket-expenses" },
            { key: "payments", fraction: share(kpis.monthlyLoanPayments), className: "bg-bucket-payments" },
            { key: "margin", fraction: share(kpis.margin), className: "bg-bucket-moving" },
          ]}
        />
      }
      detail={
        <>
          {formatEuros(income)} revenus − {formatEuros(kpis.monthlyExpenses)} dépenses − {formatEuros(kpis.monthlyLoanPayments)}{" "}
          mensualités
          {negative ? (
            <ToneText tone="bad" className="mt-1 flex">
              Vos dépenses et mensualités dépassent vos revenus.
            </ToneText>
          ) : null}
        </>
      }
      footerLabel="Taux d’endettement"
      footerValue={
        income === 0 ? (
          "—"
        ) : (
          <ToneText tone={DEBT_ALERT_TONE[kpis.debtAlert]}>
            {formatPercent(kpis.debtRatio, 1)} · {DEBT_ALERT_LABEL[kpis.debtAlert]}
          </ToneText>
        )
      }
    />
  );
}

function DebtTile({ plan, current }: { plan: ComputedPlan; current: PlanMonth }) {
  const { kpis } = plan.result;
  if (!kpis.hasDebt) {
    return <StatTile label="Dettes restantes" value={formatEuros(0)} detail="Aucun crédit en cours." />;
  }
  const repaid = kpis.totalPrincipal > 0 ? 1 - current.remainingDebt / kpis.totalPrincipal : 0;
  const gained = monthsGained(plan.result);
  const loanCount = plan.input.loans.filter((l) => l.principal > 0).length;
  return (
    <StatTile
      label="Dettes restantes"
      value={formatEuros(current.remainingDebt)}
      visual={<SegmentBar track="bg-bucket-debts-tint" segments={[{ key: "repaid", fraction: repaid, className: "bg-bucket-debts" }]} />}
      detail={`${formatPercent(repaid, 1)} remboursé depuis ${formatMonthLong(plan.input.budget.startMonth)} · ${loanCount} crédit${loanCount > 1 ? "s" : ""} · TAEG moyen ${formatPercent(kpis.weightedApr)}`}
      footerLabel="Sans dettes en"
      footerValue={
        <>
          {debtFreeText(kpis)}
          {gained && gained > 0 ? <span className="font-normal text-muted-foreground"> · {gained} mois plus tôt</span> : null}
        </>
      }
    />
  );
}

function SavingsTile({
  current,
  in12,
  goalsLabel,
  className,
}: {
  current: PlanMonth;
  in12: PlanMonth | undefined;
  /** The only goal's name, or « Objectifs » when there are several (SPEC D23). */
  goalsLabel: string;
  className?: string;
}) {
  const total = (m: PlanMonth) => m.movingCumulative + m.emergencyCumulative + m.freeSavingsCumulative;
  const now = total(current);
  const scale = Math.max(now, in12 ? total(in12) : 0);
  const frac = (cents: number) => (scale > 0 ? cents / scale : 0);
  return (
    <StatTile
      className={className}
      label="Épargne constituée"
      value={formatEuros(now)}
      visual={
        <SegmentBar
          track="bg-secondary"
          segments={[
            { key: "moving", fraction: frac(current.movingCumulative), className: "bg-bucket-moving" },
            { key: "emergency", fraction: frac(current.emergencyCumulative), className: "bg-bucket-emergency" },
            { key: "free", fraction: frac(current.freeSavingsCumulative), className: "bg-bucket-remainder" },
          ]}
        />
      }
      detail={`${goalsLabel} ${formatEuros(current.movingCumulative)} · Urgence ${formatEuros(current.emergencyCumulative)} · Libre ${formatEuros(current.freeSavingsCumulative)}`}
      footerLabel={in12 ? `Dans 12 mois (${formatMonthLong(in12.month)})` : undefined}
      footerValue={in12 ? formatEuros(total(in12)) : undefined}
    />
  );
}

/* ------------------------------------------------------------------------------ Moving warning */

function MovingAlert({
  shortfall: s,
  referenceMonth,
  goalName,
}: {
  shortfall: MovingShortfall;
  referenceMonth: YearMonth;
  /** The primary goal's name (SPEC D23). */
  goalName: string;
}) {
  const optionClass =
    "flex min-h-11 flex-col gap-1 rounded-xl border border-warning-border bg-card px-4 py-3.5 text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <section
      aria-labelledby="moving-alert-title"
      className="grid gap-4 rounded-2xl border border-warning-border bg-warning-bg p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,35rem)] xl:items-center xl:gap-8"
    >
      <div className="flex gap-4">
        <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-bucket-moving/30 text-warning md:flex">
          <TriangleAlert aria-hidden className="size-5" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 id="moving-alert-title" className="text-base font-semibold text-warning md:text-lg">
            {goalName} : il manquera {formatEuros(s.shortfall)} fin {formatMonthLong(s.deadlineMonth)}
          </h2>
          <p className="text-sm leading-relaxed text-warning tabular-nums">
            Au rythme actuel, le fonds atteindra {formatEuros(s.amountAtDeadline)} à la date limite, pour un objectif de{" "}
            {formatEuros(s.goal)}.{" "}
            {s.extraPerMonth !== null || s.deadlineThatWorks ? "Pour le tenir :" : "Ajustez l’objectif ou la date limite dans le budget."}
          </p>
        </div>
      </div>
      {s.extraPerMonth !== null || s.deadlineThatWorks ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {s.extraPerMonth !== null ? (
            <li>
              <Link href="/budget" className={optionClass}>
                <span className="text-[15px] font-semibold tabular-nums">+{formatEuros(s.extraPerMonth)} / mois</span>
                <span className="text-[13px] text-muted-foreground">
                  de moins en dépenses,{" "}
                  {s.monthsLeft === 1
                    ? `en ${formatMonthLong(s.deadlineMonth)}`
                    : `de ${formatMonthLong(referenceMonth).replace(/ \d{4}$/, "")} à ${formatMonthLong(s.deadlineMonth)}`}
                </span>
              </Link>
            </li>
          ) : null}
          {s.deadlineThatWorks ? (
            <li>
              <Link href="/budget" className={optionClass}>
                <span className="text-[15px] font-semibold">Date limite en {formatMonthLong(s.deadlineThatWorks)}</span>
                <span className="text-[13px] text-muted-foreground">l’objectif est atteint ce mois-là</span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------------------ Roadmap */

function Roadmap({ plan, refIndex }: { plan: ComputedPlan; refIndex: number }) {
  const { months } = plan.result;
  const pct = plan.input.budget.earlyRepaymentPct;
  const phases = planPhases(months);
  const events = roadmapEvents(plan.input, plan.result);
  const window = roadmapWindow(events, refIndex, months.length);
  const pos = (index: number) => `${((index - 0.5) / window) * 100}%`;
  const shown = phases.filter((p) => p.startIndex <= window);
  const summary = shown
    .map((p) => `${phaseLabel(p.kind, pct, goalsName(plan.result.kpis))} de ${formatMonthShort(p.startMonth)} à ${formatMonthShort(p.endMonth)}`)
    .join(", ");
  const years = months.slice(0, window).filter((m) => m.index === 1 || m.month.endsWith("-01"));
  const repayPct = Math.round(pct * 100);

  return (
    <section aria-labelledby="road-title" className={cn(CARD, "flex flex-col gap-5")}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 id="road-title" className="font-heading text-[22px] font-medium md:text-[26px]">
            Feuille de route
          </h2>
          <p className="hidden max-w-3xl text-sm leading-normal text-muted-foreground md:block">
            Chaque mois, l’argent disponible remplit d’abord le déménagement, puis le fonds d’urgence.{" "}
            {pct > 0
              ? `Le reste part à ${repayPct} % en remboursement anticipé, à ${100 - repayPct} % en épargne libre.`
              : "Le reste va en épargne libre."}
          </p>
        </div>
        <ArrowLink href="/plan" className="hidden md:inline-flex">
          Détail mois par mois
        </ArrowLink>
      </div>

      {/* Desktop: proportional band with today marker and milestone dots. */}
      <div className="relative hidden h-28 md:block">
        <div aria-hidden className="absolute inset-x-0 top-0 h-4 text-xs text-muted-foreground tabular-nums">
          {years.map((m) => (
            <span key={m.month} className="absolute" style={{ left: `${((m.index - 1) / window) * 100}%` }}>
              {m.month.slice(0, 4)}
            </span>
          ))}
        </div>
        <div role="img" aria-label={`Phases du plan : ${summary}.`} className="absolute inset-x-0 top-6 flex h-11 gap-[3px]">
          {shown.map((p, i) => {
            const end = Math.min(p.endIndex, window);
            const width = ((end - p.startIndex + 1) / window) * 100;
            const repayBg =
              p.kind === "repay"
                ? {
                    background:
                      pct > 0
                        ? `linear-gradient(90deg, var(--bucket-debts) 0 ${repayPct}%, var(--bucket-remainder-line) ${repayPct}% 100%)`
                        : "var(--bucket-remainder-line)",
                  }
                : undefined;
            return (
              <div
                key={`${p.kind}-${p.startIndex}`}
                title={`${phaseLabel(p.kind, pct, goalsName(plan.result.kpis))} · ${formatMonthShort(p.startMonth)} → ${formatMonthShort(p.endMonth)}`}
                className={cn(
                  "flex min-w-0 items-center overflow-hidden rounded px-3 text-[13px] font-semibold whitespace-nowrap",
                  PHASE_STYLE[p.kind].band,
                  i === 0 && "rounded-l-[10px]",
                  i === shown.length - 1 && "rounded-r-[10px]",
                )}
                style={{ width: `${width}%`, ...repayBg }}
              >
                <span className="truncate">{phaseLabel(p.kind, pct, goalsName(plan.result.kpis))}</span>
              </div>
            );
          })}
        </div>
        <div aria-hidden className="absolute inset-x-0 top-[76px] h-0.5 bg-divider" />
        {events
          .filter((e) => e.index <= window && e.kind !== "freeSavings")
          .map((e) => (
            <MilestoneDot key={`${e.kind}-${e.index}`} event={e} left={pos(e.index)} />
          ))}
        <div aria-hidden className="absolute top-4 bottom-7 w-0.5 -translate-x-px bg-foreground" style={{ left: pos(refIndex) }} />
        <div
          aria-hidden
          className="absolute bottom-1 -translate-x-1/2 rounded-md bg-primary px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-primary-foreground"
          style={{ left: pos(refIndex) }}
        >
          Aujourd’hui
        </div>
      </div>

      {/* Desktop: milestones in text (the band above is decorative). */}
      <ol className="hidden gap-x-6 gap-y-3 border-t border-divider pt-4.5 md:grid md:grid-cols-2 xl:grid-cols-4">
        {events.map((e) => (
          <li key={`${e.kind}-${e.index}`} className="flex flex-col gap-0.5">
            <span
              className={cn(
                "text-[13px] tabular-nums",
                e.tone === "warning" ? "text-warning" : e.tone === "strong" ? "font-semibold text-bad" : "text-muted-foreground",
              )}
            >
              {formatMonthShort(e.month)}
              {e.monthSuffix ? (e.monthSuffix === "→" ? " →" : ` · ${e.monthSuffix}`) : null}
            </span>
            <span className={cn("text-sm", e.tone === "strong" ? "font-semibold" : "font-medium")}>{e.text}</span>
          </li>
        ))}
      </ol>

      {/* Mobile: one line per phase. */}
      <ol className="flex flex-col gap-3.5 md:hidden">
        {phases.map((p) => (
          <MobilePhase key={`${p.kind}-${p.startIndex}`} phase={p} plan={plan} refIndex={refIndex} />
        ))}
      </ol>
      <ArrowLink href="/plan" className="md:hidden">
        Détail mois par mois
      </ArrowLink>
    </section>
  );
}

function MilestoneDot({ event, left }: { event: RoadmapEvent; left: string }) {
  const base = "absolute -translate-x-1/2";
  if (event.kind === "debtFree") {
    return (
      <div
        aria-hidden
        className={cn(base, "top-[67px] size-5 rounded-full border-[3px] border-card bg-bucket-debts ring-1 ring-bucket-debts")}
        style={{ left }}
      />
    );
  }
  if (event.kind === "deadline") {
    return <div aria-hidden className={cn(base, "top-[71px] size-3 rotate-45 rounded-[2px] bg-bucket-moving")} style={{ left }} />;
  }
  if (event.kind === "emergencyReached") {
    return <div aria-hidden className={cn(base, "top-[71px] size-3 rounded-full bg-bucket-emergency")} style={{ left }} />;
  }
  return <div aria-hidden className={cn(base, "top-[71px] size-3 rounded-full border-2 border-bucket-debts bg-card")} style={{ left }} />;
}

function MobilePhase({ phase: p, plan, refIndex }: { phase: PlanPhase; plan: ComputedPlan; refIndex: number }) {
  const { kpis, months } = plan.result;
  const now = refIndex >= p.startIndex && refIndex <= p.endIndex;
  let detail: string;
  if (p.kind === "moving") detail = `${now ? "en cours · " : ""}jusqu’en ${formatMonthShort(p.endMonth)}`;
  else if (p.kind === "emergency")
    detail = kpis.emergencyReachedMonth ? `complet en ${formatMonthShort(kpis.emergencyReachedMonth)}` : `jusqu’en ${formatMonthShort(p.endMonth)}`;
  else if (p.kind === "repay") detail = kpis.debtFreeMonth ? `plus de dettes en ${formatMonthShort(kpis.debtFreeMonth)}` : `jusqu’en ${formatMonthShort(p.endMonth)}`;
  else detail = `${formatEurosWhole(months[p.startIndex - 1]?.toFreeSavings ?? 0)} / mois en épargne libre`;
  return (
    <li className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-3">
      <span aria-hidden className={cn("mt-1 size-3.5 rounded", PHASE_STYLE[p.kind].swatch)} />
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{phaseLabel(p.kind, plan.input.budget.earlyRepaymentPct, goalsName(plan.result.kpis))}</span>
        <span className="text-[13px] text-muted-foreground">{detail}</span>
      </span>
      {now ? (
        <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Maintenant</span>
      ) : (
        <span className="text-[13px] text-muted-foreground tabular-nums">{formatMonthShort(p.startMonth)}</span>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------------------- Goals */

function Goals({ plan, current, in12 }: { plan: ComputedPlan; current: PlanMonth; in12: PlanMonth | undefined }) {
  const { kpis, months } = plan.result;
  const firstMonth = (pick: (m: PlanMonth) => number) => months.find((m) => pick(m) > 0)?.month ?? null;
  const emergencyStart = firstMonth((m) => m.toEmergency);
  const freeStart = firstMonth((m) => m.toFreeSavings);
  const freeScale = Math.max(current.freeSavingsCumulative, in12?.freeSavingsCumulative ?? 0);
  return (
    <section aria-labelledby="goals-title" className={cn(CARD, "flex flex-col gap-5.5")}>
      <h2 id="goals-title" className="text-base font-semibold md:text-[17px]">
        Objectifs d’épargne
      </h2>
      {/* One meter per savings goal, in priority order (SPEC D23). */}
      {kpis.goals.map((g, i) => {
        if (g.target <= 0) return null;
        const saved = current.goals[i]?.cumulative ?? 0;
        return (
          <Goal
            key={g.id}
            name={g.name}
            current={saved}
            goal={g.target}
            meter={
              <GoalMeter
                fraction={saved / g.target}
                projected={g.amountAtDeadline / g.target}
                fill="bg-bucket-moving"
                track="bg-bucket-moving-tint"
                hatch="bg-hatch-moving"
              />
            }
            note={
              g.met ? (
                <ToneText tone="good">Objectif atteint{g.reachedMonth ? ` en ${formatMonthLong(g.reachedMonth)}` : ""}</ToneText>
              ) : (
                <span className="text-warning">
                  Prévu fin {formatMonthShort(g.deadlineMonth)} : {formatEuros(g.amountAtDeadline)} (hachuré) · hors délai
                </span>
              )
            }
          />
        );
      })}
      {kpis.emergencyTarget > 0 ? (
        <Goal
          name="Fonds d’urgence"
          current={current.emergencyCumulative}
          goal={kpis.emergencyTarget}
          meter={
            <GoalMeter
              fraction={current.emergencyCumulative / kpis.emergencyTarget}
              fill="bg-bucket-emergency"
              track="bg-bucket-emergency-tint"
            />
          }
          note={[
            emergencyStart ? `Alimenté à partir de ${formatMonthLong(emergencyStart)}` : null,
            kpis.emergencyReachedMonth ? `complet en ${formatMonthLong(kpis.emergencyReachedMonth)}` : "non atteint sur 25 ans",
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : null}
      <Goal
        name="Épargne libre"
        current={current.freeSavingsCumulative}
        goal={null}
        meter={
          <GoalMeter
            fraction={freeScale > 0 ? current.freeSavingsCumulative / freeScale : 0}
            fill="bg-bucket-remainder"
            track="bg-bucket-remainder-tint/40"
          />
        }
        note={[
          freeStart ? `Démarre en ${formatMonthLong(freeStart)}` : "Aucun versement prévu",
          in12 ? `${formatEuros(in12.freeSavingsCumulative)} en ${formatMonthLong(in12.month)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    </section>
  );
}

function Goal({
  name,
  current,
  goal,
  meter,
  note,
}: {
  name: string;
  current: number;
  goal: number | null;
  meter: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap justify-between gap-x-3 text-sm">
        <span className="font-medium">{name}</span>
        <span className="tabular-nums">
          <b>{formatEuros(current)}</b>
          {goal !== null ? ` / ${formatEuros(goal)}` : null}
        </span>
      </div>
      {meter}
      <p className="text-[13px] text-muted-foreground tabular-nums">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ Check-ins, loan order */

function CheckInStripCard({ slots, startMonth }: { slots: CheckInSlot[]; startMonth: YearMonth }) {
  return (
    <section aria-labelledby="suivi-title" className={cn(CARD, "flex flex-col gap-4")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="suivi-title" className="text-base font-semibold md:text-[17px]">
          Suivi réel
        </h2>
        <ArrowLink href="/suivi">Historique</ArrowLink>
      </div>
      {slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Le suivi commence en {formatMonthLong(startMonth)}.</p>
      ) : (
        <ol className="grid gap-2.5 sm:grid-cols-3">
          {slots.map((slot) => (
            <CheckInTile key={slot.month} slot={slot} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CheckInTile({ slot }: { slot: CheckInSlot }) {
  const monthName = <span className="text-[13px] text-muted-foreground first-letter:uppercase">{formatMonthLong(slot.month)}</span>;
  const status = slot.comparison?.status ?? null;
  if (slot.state === "entered") {
    const c = slot.comparison!;
    return (
      <li className={cn("flex flex-col gap-1.5 rounded-xl border p-3.5", status ? STATUS_TONE[status].tile : "bg-secondary")}>
        {monthName}
        {status ? (
          <ToneText tone={status === "onTrack" ? "good" : status === "mixed" ? "warning" : "bad"} className="text-sm font-semibold">
            {STATUS_LABEL[status]}
          </ToneText>
        ) : (
          <span className="text-sm font-semibold">Saisi</span>
        )}
        {c.debtGap !== null && c.savingsGap !== null ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            écarts : dette {formatSignedEuros(c.debtGap)} · épargne {formatSignedEuros(c.savingsGap)}
          </span>
        ) : null}
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-dashed border-input p-3.5">
      {monthName}
      <span className="text-sm font-semibold">{slot.state === "current" ? "En cours" : "À saisir"}</span>
      {slot.state === "current" ? (
        <span className="text-xs text-muted-foreground">à saisir en fin de mois</span>
      ) : (
        <Link
          href={checkInHref(slot.month)}
          className="text-xs font-medium text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Saisir {formatMonthLong(slot.month)} →
        </Link>
      )}
    </li>
  );
}

function RepaymentOrder({ plan }: { plan: ComputedPlan }) {
  const { loans, kpis } = plan.result;
  const aprById = new Map(plan.input.loans.map((l) => [l.id, l.apr]));
  const sorted = [...loans].sort((a, b) => {
    if (a.priority !== null && b.priority !== null) return a.priority - b.priority;
    if (a.priority !== null) return -1;
    if (b.priority !== null) return 1;
    return (aprById.get(b.id) ?? 0) - (aprById.get(a.id) ?? 0);
  });
  return (
    <section aria-labelledby="loans-title" className={cn(CARD, "flex flex-col gap-3.5")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="loans-title" className="text-base font-semibold md:text-[17px]">
          Ordre de remboursement anticipé
        </h2>
        <ArrowLink href="/credits">Crédits</ArrowLink>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun crédit en cours.</p>
      ) : (
        <ol className="flex flex-col">
          {sorted.map((loan) => (
            <li
              key={loan.id}
              className={cn(
                "grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-divider py-2.5 text-sm last:border-b-0",
                loan.priority === null && "text-muted-foreground",
              )}
            >
              {loan.priority !== null ? (
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                    loan.priority === 1 ? "bg-bucket-debts text-white" : "bg-bucket-debts-tint text-bucket-debts-ink",
                  )}
                >
                  <span className="sr-only">Priorité </span>
                  {loan.priority}
                </span>
              ) : (
                <span className="text-center" aria-label="Non prioritaire">
                  —
                </span>
              )}
              <span className={loan.priority !== null ? "font-medium" : undefined}>
                {loan.displayName}
                {loan.priority === null ? " · sous le taux seuil" : null}
              </span>
              <span className="text-right tabular-nums">{formatPercent(aprById.get(loan.id) ?? 0)}</span>
              <span className="w-20 text-right text-muted-foreground tabular-nums">
                {loan.payoffMonthWithPlan ? formatMonthShort(loan.payoffMonthWithPlan) : "> 25 ans"}
              </span>
            </li>
          ))}
        </ol>
      )}
      {kpis.hasDebt && kpis.interestSaved > 0 ? (
        <p className="text-[13px] font-medium text-good tabular-nums">
          {formatEuros(kpis.interestSaved)} d’intérêts économisés grâce au plan
          {kpis.penaltiesPaid > 0 ? `, net de ${formatEuros(kpis.penaltiesPaid)} d’IRA` : ""}
        </p>
      ) : null}
    </section>
  );
}
