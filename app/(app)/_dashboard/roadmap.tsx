/** Plan roadmap: phases and milestones on a timeline (list on mobile). */
import { ArrowLink } from "@/components/app/nav";
import { PHASE_STYLE } from "@/components/app/tones";
import type { ComputedPlan } from "@/lib/domain/plan";
import { formatEurosWhole, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type PlanPhase, type RoadmapEvent, goalsName, phaseLabel, planPhases, roadmapEvents, roadmapWindow } from "./logic";
import { CARD } from "./styles";

export function Roadmap({ plan, refIndex }: { plan: ComputedPlan; refIndex: number }) {
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
