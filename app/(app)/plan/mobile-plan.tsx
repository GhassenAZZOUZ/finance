"use client";

/**
 * Phone layout of /plan (#113; docs/design/MOBILE.md §2, mockup MobilePlan.dc.html): one card per
 * month with its allocation bar, grouped by year under sticky headers naming the phase. A card opens
 * its full breakdown; runs of identical months are folded.
 */
import { ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { PHASE_STYLE } from "@/components/app/tones";
import type { ComputedPlan } from "@/lib/domain/plan";
import { HORIZON_MONTHS, type PlanMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type PhaseKind, type PlanPhase, goalsName, primaryGoalName } from "../_dashboard/logic";
import type { PlanMilestones } from "./milestones";
import {
  type MonthEvent,
  type MonthGroup,
  allocationParts,
  groupIdentical,
  monthEvents,
  phaseAt,
  shortName,
  yearPhaseLabel,
} from "./mobile-plan-logic";

const RANGES = [
  { count: 18, label: "18 mois" },
  { count: 60, label: "5 ans" },
  { count: HORIZON_MONTHS, label: "25 ans" },
] as const;

const PARTS = [
  { key: "moving", label: "Objectifs", swatch: "bg-bucket-moving" },
  { key: "emergency", label: "Urgence", swatch: "bg-bucket-emergency" },
  { key: "repay", label: "Remb. anticipé", swatch: "bg-bucket-debts" },
  { key: "free", label: "Épargne libre", swatch: "bg-bucket-remainder" },
] as const;

const EVENT_STYLE: Record<MonthEvent["kind"], string> = {
  today: "bg-primary text-primary-foreground",
  negative: "bg-bad text-white",
  payoff: "bg-bucket-debts-tint text-bucket-debts-ink",
  debtFree: "bg-bucket-debts text-white",
  deadline: "bg-warning-bg text-warning",
  goals: "bg-bucket-moving text-on-bucket-moving",
  emergency: "bg-bucket-emergency text-white",
  income: "bg-good-bg text-good",
  expense: "bg-bad-bg text-bad",
};

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
const monthOnly = (m: PlanMonth) => formatMonthLong(m.month).replace(/ \d{4}$/, "");

export function MobilePlan({
  plan,
  months,
  rowCount,
  milestones,
  phases,
  todayIndex,
}: {
  plan: ComputedPlan;
  /** The months shown (the first `rowCount`). */
  months: readonly PlanMonth[];
  rowCount: number;
  milestones: PlanMilestones;
  phases: PlanPhase[];
  todayIndex: number;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const goals = goalsName(plan.result.kpis);
  const names = { goals, primary: primaryGoalName(plan.result.kpis) };
  const pct = plan.input.budget.earlyRepaymentPct;
  const hasLoans = plan.input.loans.length > 0;
  const events = new Map(months.map((m) => [m.index, monthEvents(m, milestones, todayIndex, names)]));

  const years = new Map<string, PlanMonth[]>();
  for (const m of months) {
    const y = m.month.slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), m]);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link
          href="/plus"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-full px-2 text-[15px] font-medium text-link focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronLeft aria-hidden className="size-5" />
          Plus
        </Link>
        <h1 className="font-heading text-[28px] leading-[1.15] font-medium tracking-[-0.01em]">Plan mois par mois</h1>
        <nav aria-label="Période affichée" className="flex gap-2">
          {RANGES.map((r) => {
            const active = r.count === rowCount;
            return (
              <Link
                key={r.count}
                href={`/plan?mois=${r.count}`}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                )}
              >
                {r.label}
              </Link>
            );
          })}
        </nav>
        <ul aria-label="Légende" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {PARTS.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-[3px]", p.swatch)} />
              {p.key === "moving" ? goals : p.label}
            </li>
          ))}
        </ul>
      </header>

      {[...years].map(([year, list]) => (
        <section key={year} aria-labelledby={`plan-year-${year}`} className="flex flex-col gap-2.5 [content-visibility:auto]">
          <h2
            id={`plan-year-${year}`}
            className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 text-[13px] font-semibold tracking-[0.02em] backdrop-blur"
          >
            {year} · {yearPhaseLabel(list, phases, goals, pct)}
          </h2>
          <ol className="flex flex-col gap-2.5">
            {groupIdentical(list, (m) => (events.get(m.index)?.length ?? 0) > 0).map((group) => (
              <Group
                key={group.head.index}
                group={group}
                open={expanded.has(group.head.index)}
                onOpen={() => setExpanded((s) => new Set(s).add(group.head.index))}
                render={(m) => (
                  <MonthCard
                    key={m.index}
                    month={m}
                    events={events.get(m.index) ?? []}
                    today={m.index === todayIndex}
                    deadline={milestones.deadlineIndex === m.index}
                    phase={phaseAt(phases, m.index)}
                    goals={goals}
                    hasLoans={hasLoans}
                  />
                )}
              />
            ))}
          </ol>
        </section>
      ))}

      {months.length < rowCount ? (
        <p className="text-center text-sm text-muted-foreground">Fin du plan : {months.length} mois simulés.</p>
      ) : null}
    </div>
  );
}

function Group({
  group,
  open,
  onOpen,
  render,
}: {
  group: MonthGroup;
  open: boolean;
  onOpen: () => void;
  render: (m: PlanMonth) => ReactNode;
}) {
  // A single identical month is not worth folding.
  if (group.same.length < 2 || open) return <>{[group.head, ...group.same].map(render)}</>;
  const first = group.same[0]!;
  const last = group.same.at(-1)!;
  return (
    <>
      {render(group.head)}
      <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-2xl border border-dashed border-input px-4 py-2 text-sm text-muted-foreground">
        <span>
          {capitalise(monthOnly(first))} à {formatMonthLong(last.month)} : identiques à {monthOnly(group.head)}
        </span>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Afficher ${monthOnly(first)} à ${formatMonthLong(last.month)}`}
          className="min-h-11 font-medium text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          afficher
        </button>
      </li>
    </>
  );
}

function MonthCard({
  month: m,
  events,
  today,
  deadline,
  phase,
  goals,
  hasLoans,
}: {
  month: PlanMonth;
  events: MonthEvent[];
  today: boolean;
  deadline: boolean;
  phase: PhaseKind;
  goals: string;
  hasLoans: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parts = allocationParts(m);
  const total = parts.moving + parts.emergency + parts.repay + parts.free;
  const negative = m.negativeBudget;
  const name = capitalise(monthOnly(m));
  const bucket =
    phase === "moving"
      ? `${shortName(goals)} ${formatEuros(m.movingCumulative)}`
      : phase === "emergency"
        ? `Urgence ${formatEuros(m.emergencyCumulative)}`
        : `Épargne ${formatEuros(m.freeSavingsCumulative)}`;
  const detailsId = `plan-month-${m.index}`;
  return (
    <li
      aria-label={formatMonthLong(m.month)}
      aria-current={today ? "date" : undefined}
      className={cn(
        "flex flex-col rounded-2xl border bg-card",
        today && "border-foreground ring-1 ring-foreground",
        deadline && !negative && "bg-warning-bg",
        negative && "border-bad-border bg-bad-bg text-bad",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
        className="flex flex-col gap-2.5 rounded-2xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold">
              {name}
              <span className="sr-only"> {m.month.slice(0, 4)}</span>
            </span>
            {events.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {events.map((e, i) => (
                  <span key={i} className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", EVENT_STYLE[e.kind])}>
                    {e.label}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-heading text-lg font-medium tabular-nums">
              <span className="sr-only">Disponible </span>
              {formatEuros(m.available)}
            </span>
            <ChevronDown aria-hidden className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </span>
        </span>
        {total > 0 ? (
          <span
            role="img"
            aria-label={PARTS.filter((p) => parts[p.key] > 0)
              .map((p) => `${p.key === "moving" ? goals : p.label} ${formatEuros(parts[p.key])}`)
              .join(", ")}
            className="flex h-2 gap-px overflow-hidden rounded-full bg-divider"
          >
            {PARTS.filter((p) => parts[p.key] > 0).map((p) => (
              <span key={p.key} className={p.swatch} style={{ width: `${(parts[p.key] / total) * 100}%` }} />
            ))}
          </span>
        ) : null}
        <span className={cn("text-[13px] tabular-nums", negative ? "text-bad" : "text-muted-foreground")}>
          {bucket}
          {hasLoans ? ` · Dettes ${formatEuros(m.remainingDebt)}` : ""}
        </span>
      </button>
      <dl id={detailsId} hidden={!open} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-divider px-4 py-3 text-sm tabular-nums">
        <Row label="Revenus" value={m.income} />
        <Row label="Dépenses" value={m.expenses} />
        <Row label="Mensualités" value={m.loanPayments} />
        <Row label="Disponible" value={m.available} strong />
        <Row label={`① ${goals}`} value={m.toMoving} swatch={PHASE_STYLE.moving.swatch} />
        <Row label="② Fonds d’urgence" value={m.toEmergency} swatch={PHASE_STYLE.emergency.swatch} />
        <Row label="③ Remboursement anticipé" value={parts.repay} swatch={PHASE_STYLE.repay.swatch} />
        <Row label="Épargne libre" value={m.toFreeSavings} swatch={PHASE_STYLE.free.swatch} />
        {hasLoans ? <Row label="Dettes restantes" value={m.remainingDebt} /> : null}
      </dl>
    </li>
  );
}

function Row({ label, value, strong = false, swatch }: { label: string; value: number; strong?: boolean; swatch?: string }) {
  return (
    <>
      <dt className={cn("flex items-center gap-1.5", strong ? "font-semibold" : "text-muted-foreground")}>
        {swatch ? <span aria-hidden className={cn("size-2.5 rounded-[3px]", swatch)} /> : null}
        {label}
      </dt>
      <dd className={cn("text-right", strong && "font-semibold")}>{formatEuros(value)}</dd>
    </>
  );
}
