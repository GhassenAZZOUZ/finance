"use client";

/**
 * Mobile home (< md, issue #109; docs/design/MOBILE.md §2, mockup Mobile.dc.html): one sentence,
 * the month's margin, what to do next. No charts: they stay on the desktop dashboard and on Plan.
 */
import { CalendarCheck, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { checkInHref } from "@/components/app/nav";
import type { ComputedPlan } from "@/lib/domain/plan";
import { type PlanMonth, type YearMonth, monthsBetween } from "@/lib/engine";
import { formatEuros, formatEurosWhole, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DEBT_ALERT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Goals } from "./goals";
import { type RoadmapEvent, headlineParts, movingShortfallOptions, nextSteps, primaryGoalName } from "./logic";

const CARD = "rounded-[18px] border bg-card";
const ACTION =
  "flex min-h-13 items-center justify-between gap-3 rounded-[14px] border border-warning-border bg-card px-4 text-[15px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const savings = (m: PlanMonth | undefined) => (m ? m.movingCumulative + m.emergencyCumulative + m.freeSavingsCumulative : 0);
const monthName = (month: YearMonth) => formatMonthLong(month).replace(/ \d{4}$/, "");

export function MobileHome({ plan, pending }: { plan: ComputedPlan; pending: readonly YearMonth[] }) {
  const { kpis, months } = plan.result;
  const refIndex = monthsBetween(plan.input.budget.startMonth, plan.referenceMonth) + 1;
  const current = months[refIndex - 1]!;
  const in12 = months[refIndex - 1 + 12];
  const shortfall = useMemo(
    () => movingShortfallOptions(plan.input, plan.result, plan.referenceMonth),
    [plan.input, plan.result, plan.referenceMonth],
  );
  const steps = nextSteps(plan.input, plan.result, plan.referenceMonth);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="mt-1 font-heading text-[27px] leading-[1.15] font-medium">
        {headlineParts(kpis).map((p, i) => (
          <span key={p.text} className={p.warning ? "text-warning" : undefined}>
            {i > 0 ? " " : ""}
            {p.text}
          </span>
        ))}
      </h1>

      <MarginCard plan={plan} />

      {pending[0] ? (
        <Link
          href={checkInHref(pending[0])}
          className={cn(CARD, "flex min-h-11 items-center gap-3.5 px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}
        >
          <span aria-hidden className="flex size-10.5 shrink-0 items-center justify-center rounded-xl bg-warning-bg text-warning">
            <CalendarCheck className="size-5" />
          </span>
          <span className="flex grow flex-col gap-0.5">
            <b className="text-[15px] font-semibold">Saisir {formatMonthLong(pending[0])}</b>
            <span className="text-[13px] text-muted-foreground">
              {pending.length} mois de suivi en attente
            </span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}

      <ul
        aria-label="Chiffres clés"
        className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
      >
        <li className="w-39 shrink-0 snap-start">
          <Link
            href="/credits"
            className={cn(CARD, "flex h-full flex-col gap-1.5 p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring")}
          >
            <span className="text-[13px] text-muted-foreground">Dettes</span>
            <span className="font-heading text-[26px] leading-[1.05] tabular-nums">{formatEuros(current.remainingDebt)}</span>
            <span className="text-[13px] text-muted-foreground">
              {!kpis.hasDebt ? "aucun crédit" : kpis.debtFreeMonth ? `fin en ${formatMonthLong(kpis.debtFreeMonth)}` : "au-delà de 25 ans"}
            </span>
            {kpis.hasDebt && kpis.totalPrincipal > 0 ? (
              <Meter fraction={1 - current.remainingDebt / kpis.totalPrincipal} track="bg-bucket-debts-tint" fill="bg-bucket-debts" />
            ) : null}
          </Link>
        </li>
        <li className={cn(CARD, "flex w-39 shrink-0 snap-start flex-col gap-1.5 p-4")}>
          <span className="text-[13px] text-muted-foreground">Épargne</span>
          <span className="font-heading text-[26px] leading-[1.05] tabular-nums">{formatEuros(savings(current))}</span>
          {in12 ? <span className="text-[13px] text-muted-foreground tabular-nums">{formatEuros(savings(in12))} dans 12 mois</span> : null}
        </li>
        {kpis.hasDebt ? (
          <li className={cn(CARD, "flex w-39 shrink-0 snap-start flex-col gap-1.5 p-4")}>
            <span className="text-[13px] text-muted-foreground">Intérêts évités</span>
            <span className="font-heading text-[26px] leading-[1.05] text-good tabular-nums">{formatEuros(kpis.interestSaved)}</span>
            <span className="text-[13px] text-muted-foreground">grâce au plan</span>
          </li>
        ) : null}
      </ul>

      {shortfall ? (
        <section aria-labelledby="mobile-moving-title" className="flex flex-col gap-2.5 rounded-[18px] border border-warning-border bg-warning-bg p-4">
          <div className="flex flex-col gap-1">
            <h2 id="mobile-moving-title" className="text-base font-semibold text-warning">
              {primaryGoalName(kpis)} : il manquera {formatEuros(shortfall.shortfall)}
            </h2>
            <p className="text-sm leading-relaxed text-warning tabular-nums">
              {formatEuros(shortfall.amountAtDeadline)} prévus fin {formatMonthShort(shortfall.deadlineMonth)} pour {formatEuros(shortfall.goal)}.
            </p>
          </div>
          {shortfall.extraPerMonth !== null ? (
            <Link href="/budget" className={ACTION}>
              <span className="tabular-nums">
                <b>+{formatEuros(shortfall.extraPerMonth)} / mois</b> d’ici {formatMonthShort(shortfall.deadlineMonth).replace(/ \d{4}$/, "")}
              </span>
              <ChevronRight aria-hidden className="size-4.5 shrink-0" />
            </Link>
          ) : null}
          {shortfall.deadlineThatWorks ? (
            <Link href="/budget" className={ACTION}>
              <b>Date limite en {formatMonthShort(shortfall.deadlineThatWorks)}</b>
              <ChevronRight aria-hidden className="size-4.5 shrink-0" />
            </Link>
          ) : null}
        </section>
      ) : null}

      {steps.length > 0 ? (
        <section aria-labelledby="mobile-steps-title" className={cn(CARD, "flex flex-col gap-3.5 px-4 py-4.5")}>
          <div className="flex items-baseline justify-between">
            <h2 id="mobile-steps-title" className="font-heading text-[22px] font-medium">
              Prochaines étapes
            </h2>
            <Link href="/plan" className="text-sm font-medium text-link">
              Plan
            </Link>
          </div>
          <ol className="flex flex-col gap-4">
            {steps.map((e) => (
              <Step key={`${e.kind}-${e.index}`} event={e} />
            ))}
          </ol>
        </section>
      ) : null}

      <Goals plan={plan} current={current} in12={in12} />
    </div>
  );
}

function MarginCard({ plan }: { plan: ComputedPlan }) {
  const k = plan.result.kpis;
  const income = k.monthlyIncome;
  const share = (cents: number) => (income > 0 ? Math.max(0, cents) / income : 0);
  return (
    <section aria-label="Marge du mois" className="flex flex-col gap-3.5 rounded-[22px] bg-foreground p-5 text-background">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] opacity-80">Marge de {monthName(plan.referenceMonth)}</span>
        {income > 0 ? (
          <span className="text-xs font-semibold">
            Endettement {formatPercent(k.debtRatio, 1)} · {DEBT_ALERT_LABEL[k.debtAlert]}
          </span>
        ) : null}
      </div>
      <span className="font-heading text-[46px] leading-none font-medium tabular-nums">{formatEuros(k.margin)}</span>
      <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-background/15">
        <span className="bg-bucket-payments-strong" style={{ width: `${share(k.monthlyExpenses) * 100}%` }} />
        <span className="bg-bucket-fixed" style={{ width: `${share(k.monthlyLoanPayments) * 100}%` }} />
        <span className="bg-bucket-moving" style={{ width: `${share(k.margin) * 100}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums opacity-90">
        <Figure value={formatEurosWhole(income)} label="revenus" />
        <Figure value={formatEurosWhole(k.monthlyExpenses)} label="dépenses" />
        <Figure value={formatEuros(k.monthlyLoanPayments)} label="crédits" />
      </div>
      {k.margin < 0 ? <p className="text-sm font-medium">Vos dépenses et mensualités dépassent vos revenus.</p> : null}
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex flex-col">
      <b className="text-sm font-semibold">{value}</b>
      {label}
    </span>
  );
}

function Meter({ fraction, track, fill }: { fraction: number; track: string; fill: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <span aria-hidden className={cn("mt-1 block h-1.5 rounded-full", track)}>
      <span className={cn("block h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
    </span>
  );
}

const STEP_DOT: Record<RoadmapEvent["kind"], string> = {
  loanPaidOff: "bg-bucket-debts",
  debtFree: "bg-bucket-debts",
  deadline: "bg-bucket-moving",
  emergencyReached: "bg-bucket-emergency",
  freeSavings: "bg-bucket-remainder",
};

function Step({ event }: { event: RoadmapEvent }) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-3">
      <span aria-hidden className={cn("mx-1 mt-1 size-3 rounded-full", STEP_DOT[event.kind])} />
      <b className={cn("text-sm font-semibold", event.tone === "warning" && "text-warning")}>{event.text}</b>
      <span className="text-[13px] text-muted-foreground tabular-nums">{formatMonthShort(event.month)}</span>
    </li>
  );
}
