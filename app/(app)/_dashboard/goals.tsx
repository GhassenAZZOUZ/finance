/** Savings goals progress on the dashboard. */
import type { ReactNode } from "react";
import type { ComputedPlan } from "@/lib/domain/plan";
import type { PlanMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GoalMeter, ToneText } from "./kpi";
import { CARD } from "./styles";

export function Goals({ plan, current, in12 }: { plan: ComputedPlan; current: PlanMonth; in12: PlanMonth | undefined }) {
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
