/** KPI tiles of the dashboard: margin, debt, savings. */
import type { ComputedPlan } from "@/lib/domain/plan";
import type { PlanKpis, PlanMonth, YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DEBT_ALERT_LABEL, debtFreeText } from "@/lib/labels";
import { SegmentBar, StatTile, type Tone, ToneText } from "./kpi";
import { monthsGained } from "./logic";

const DEBT_ALERT_TONE: Record<PlanKpis["debtAlert"], Tone> = { ok: "good", warning: "warning", alert: "bad" };

export function MarginTile({ kpis, month }: { kpis: PlanKpis; month: YearMonth }) {
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

export function DebtTile({ plan, current }: { plan: ComputedPlan; current: PlanMonth }) {
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

export function SavingsTile({
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
