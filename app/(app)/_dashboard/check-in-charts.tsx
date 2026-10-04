"use client";

/** The dashboard's « Suivi » row: monthly gaps (issue #91) and spending by line (issue #92). */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ComputedPlan } from "@/lib/domain/plan";
import { GAP_TOLERANCE, centsToEuros } from "@/lib/engine";
import { formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { gapTone, gapsSeries, gapsSummary, latestSpending, spendingSummary } from "./chart-series";
import { formatSignedEuros } from "./logic";
import type { Row } from "./plan-line-chart";
import { PlanStackChart } from "./plan-stack-chart";
import { CARD } from "./styles";

const TONE_FILL = { good: "var(--good)", bad: "var(--bad)" } as const;
const tolerance = centsToEuros(GAP_TOLERANCE);

/** What the status colours mean: colour is never the only signal (the table spells it out too). */
function ToneNote({ good, bad }: { good?: string; bad: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {good ? (
        <>
          <span aria-hidden className="inline-block size-3 rounded-[3px] bg-good" />
          <span className="mr-2">{good}</span>
        </>
      ) : null}
      <span aria-hidden className="inline-block size-3 rounded-[3px] bg-bad" />
      {bad}
    </span>
  );
}

export function CheckInCharts({ plan, firstCheckInHref }: { plan: ComputedPlan; firstCheckInHref: string }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <GapsCard plan={plan} firstCheckInHref={firstCheckInHref} />
      <SpendingCard plan={plan} />
    </div>
  );
}

function GapsCard({ plan, firstCheckInHref }: { plan: ComputedPlan; firstCheckInHref: string }) {
  const data = gapsSeries(plan.comparisons);
  return (
    <section aria-labelledby="gaps-title" className={cn(CARD, "flex min-w-0 flex-col gap-4")}>
      <div className="flex flex-col gap-1">
        <h2 id="gaps-title" className="text-base font-semibold md:text-[17px]">
          Écarts au plan, mois par mois
        </h2>
        <p className="text-sm text-muted-foreground">Revenus et dépenses réels moins prévus, sur vos 12 derniers mois saisis.</p>
      </div>
      {data.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm">Saisissez votre premier mois pour comparer vos revenus et dépenses au plan.</p>
          <Button asChild variant="outline" className="min-h-11 px-4.5 text-[15px]">
            <Link href={firstCheckInHref}>Saisir mon premier mois</Link>
          </Button>
        </div>
      ) : (
        <PlanStackChart
          data={data}
          signedValues
          zeroLine
          summary={gapsSummary(plan.comparisons)}
          tableCaption="Écarts des revenus et des dépenses au plan, par mois de suivi"
          legendNote={<ToneNote good="vert : dans la tolérance de 10 €" bad="rouge : au-delà" />}
          formatCell={(value, key) => {
            if (typeof value !== "number") return "—";
            const tone = gapTone(key as "incomeGap" | "expensesGap", value);
            return `${formatSignedEuros(Math.round(value * 100))}${tone === "bad" ? " (hors tolérance)" : ""}`;
          }}
          series={[
            {
              key: "incomeGap",
              name: "Revenus (plein)",
              color: "var(--muted-foreground)",
              type: "bar",
              fillFor: (row: Row) => TONE_FILL[gapTone("incomeGap", row.incomeGap as number | null) ?? "good"],
            },
            {
              key: "expensesGap",
              name: "Dépenses (contour)",
              color: "var(--muted-foreground)",
              type: "bar",
              outline: true,
              fillFor: (row: Row) => TONE_FILL[gapTone("expensesGap", row.expensesGap as number | null) ?? "good"],
            },
          ]}
        />
      )}
    </section>
  );
}

function SpendingCard({ plan }: { plan: ComputedPlan }) {
  const spending = latestSpending(plan.actuals);
  if (!spending) return null;
  return (
    <section aria-labelledby="spending-title" className={cn(CARD, "flex min-w-0 flex-col gap-4")}>
      <div className="flex flex-col gap-1">
        <h2 id="spending-title" className="text-base font-semibold md:text-[17px]">
          Dépenses par poste, {formatMonthLong(spending.month)}
        </h2>
        <p className="text-sm text-muted-foreground">Prévu et réel pour chaque poste du dernier mois saisi, plus gros dépassement en premier.</p>
      </div>
      {!spending.detailed ? (
        <p className="text-sm">Ce mois a été saisi sans le détail des postes.</p>
      ) : spending.rows.length === 0 ? (
        <p className="text-sm">Aucune dépense saisie ce mois-là.</p>
      ) : (
        <PlanStackChart
          horizontal
          rowHeader="Poste"
          data={spending.rows}
          summary={spendingSummary(spending)}
          tableCaption={`Dépenses prévues et réelles par poste, ${formatMonthLong(spending.month)}`}
          legendNote={<ToneNote bad="rouge : dépassement de plus de 10 €" />}
          series={[
            { key: "planned", name: "Prévu (contour)", color: "var(--bucket-payments-strong)", type: "bar", outline: true },
            {
              key: "actual",
              name: "Réel",
              color: "var(--bucket-payments-strong)",
              type: "bar",
              fillFor: (row: Row) => ((row.gap as number) > tolerance ? TONE_FILL.bad : "var(--bucket-payments-strong)"),
            },
            { key: "gap", name: "Écart", color: "var(--foreground)", type: "bar", tooltipOnly: true, signed: true },
          ]}
        />
      )}
    </section>
  );
}
