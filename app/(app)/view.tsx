"use client";

import { CalendarCheck, CircleAlert, CircleCheck, CreditCard, Hourglass, ShieldCheck, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { GAP_TONE, PLAN_GROUP } from "@/components/app/tones";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFinance } from "@/components/app/finance-provider";
import { type ActualComparison, type PlanKpis, type PlanMonth, type YearMonth, latestActual } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { debtAlertText, debtFreeText, emergencyReachedText, movingReachedText, movingStatusText } from "@/lib/labels";
import { KpiCard, KpiRow, type Tone, ToneText } from "./_dashboard/kpi";
import {
  type GapTone,
  debtGapTone,
  debtSavingsSeries,
  debtSavingsSummary,
  formatSignedEuros,
  fundsSeries,
  fundsSummary,
  savingsGapTone,
} from "./_dashboard/logic";
import { PlanLineChart } from "./_dashboard/plan-line-chart";

const LINK_CLASS =
  "font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const DEBT_ALERT_TONE: Record<PlanKpis["debtAlert"], Tone> = { ok: "good", warning: "warning", alert: "bad" };

export function DashboardView() {
  const { snapshot, plan } = useFinance();
  if (!plan) {
    return (
      <>
        <PageHeader title="Tableau de bord" />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }

  const { kpis, months } = plan.result;
  return (
    <>
      <PageHeader title="Tableau de bord" description="Synthèse de votre plan, recalculée à chaque modification." />
      <NegativeBudgetNotice count={kpis.negativeBudgetMonths} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SituationCard kpis={kpis} month={plan.referenceMonth} />
        <MovingCard kpis={kpis} />
        <LatestActualCard latest={latestActual(plan.comparisons)} />
        <DebtCard kpis={kpis} />
        <EmergencyCard kpis={kpis} />
        <HorizonCard kpis={kpis} month12={months[11]} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Dettes et épargne libre sur 24 mois</h2>
            </CardTitle>
            <CardDescription>La dette doit descendre vers 0, l’épargne libre monter.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanLineChart
              data={debtSavingsSeries(months)}
              summary={debtSavingsSummary(months)}
              tableCaption="Dette restante et épargne libre cumulée, par mois"
              series={[
                { key: "debt", name: "Dette restante", color: PLAN_GROUP.debts.stroke },
                { key: "freeSavings", name: "Épargne libre cumulée", color: PLAN_GROUP.remainder.stroke },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Fonds déménagement et urgence sur 12 mois</h2>
            </CardTitle>
            <CardDescription>Montants cumulés (traits pleins) face aux objectifs (pointillés).</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanLineChart
              data={fundsSeries(months, kpis.movingGoal, kpis.emergencyTarget)}
              summary={fundsSummary(months, kpis.movingGoal, kpis.emergencyTarget)}
              tableCaption="Fonds déménagement et fonds d'urgence cumulés, avec leurs objectifs, par mois"
              series={[
                { key: "moving", name: "Fonds déménagement", color: PLAN_GROUP.moving.stroke, marker: "circle" },
                { key: "movingGoal", name: "Objectif déménagement", color: PLAN_GROUP.moving.stroke, dashed: true },
                { key: "emergency", name: "Fonds d'urgence", color: PLAN_GROUP.emergency.stroke, marker: "square" },
                { key: "emergencyTarget", name: "Objectif urgence", color: PLAN_GROUP.emergency.stroke, dashed: true },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NegativeBudgetNotice({ count }: { count: number }) {
  if (count === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-green-800">
        <CircleCheck aria-hidden className="size-4" />
        Aucun mois en budget négatif.
      </p>
    );
  }
  return (
    <Alert variant="destructive" className="border-red-300 bg-red-50 px-4 py-3">
      <CircleAlert aria-hidden />
      <AlertTitle className="text-red-800">
        {count} mois en budget négatif
      </AlertTitle>
      <AlertDescription className="text-red-800">
        Ces mois-là, revenus moins dépenses et mensualités sont négatifs : rien n’est épargné.{" "}
        <Link href="/plan" className="font-medium text-red-900 underline underline-offset-4">
          Voir le plan mois par mois
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/** Budget figures of the reference month (SPEC D15): budget lines may change over time. */
function SituationCard({ kpis, month }: { kpis: PlanKpis; month: YearMonth }) {
  const noIncome = kpis.monthlyIncome === 0;
  const negativeMargin = kpis.margin < 0;
  return (
    <KpiCard title={`Situation mensuelle (${formatMonthShort(month)})`} icon={Wallet}>
      <KpiRow label="Revenus" value={formatEuros(kpis.monthlyIncome)} />
      <KpiRow label="Dépenses" value={formatEuros(kpis.monthlyExpenses)} />
      <KpiRow label="Mensualités de crédit" value={formatEuros(kpis.monthlyLoanPayments)} />
      <KpiRow
        label="Marge"
        value={formatEuros(kpis.margin)}
        tone={negativeMargin ? "bad" : undefined}
        hint={
          negativeMargin ? (
            <ToneText tone="bad">Vos dépenses et mensualités dépassent vos revenus.</ToneText>
          ) : undefined
        }
      />
      <KpiRow
        label="Taux d’endettement"
        value={noIncome ? "—" : formatPercent(kpis.debtRatio, 1)}
        hint={
          noIncome ? (
            "Aucun revenu renseigné."
          ) : (
            <ToneText tone={DEBT_ALERT_TONE[kpis.debtAlert]}>{debtAlertText(kpis)}</ToneText>
          )
        }
      />
      <KpiRow label="Capital restant dû" value={kpis.hasDebt ? formatEuros(kpis.totalPrincipal) : "Aucune dette"} />
      <KpiRow label="TAEG moyen pondéré" value={kpis.hasDebt ? formatPercent(kpis.weightedApr) : "—"} />
    </KpiCard>
  );
}

function MovingCard({ kpis }: { kpis: PlanKpis }) {
  return (
    <KpiCard title="Déménagement" icon={Truck}>
      <KpiRow label="Objectif" value={formatEuros(kpis.movingGoal)} />
      <KpiRow
        label="À épargner par mois"
        value={kpis.deadlineBeforeStart ? <ToneText tone="bad">Date limite dépassée</ToneText> : formatEuros(kpis.movingMonthlyNeeded)}
      />
      <KpiRow label="Montant à la date limite" value={formatEuros(kpis.movingAmountAtDeadline)} />
      <KpiRow label="Objectif atteint en" value={movingReachedText(kpis)} />
      <div className="py-2 last:pb-0">
        <dt className="sr-only">Statut</dt>
        <dd className="text-sm font-medium">
          <ToneText tone={kpis.movingGoalMet ? "good" : "bad"}>{movingStatusText(kpis)}</ToneText>
        </dd>
      </div>
    </KpiCard>
  );
}

function EmergencyCard({ kpis }: { kpis: PlanKpis }) {
  return (
    <KpiCard title="Fonds d’urgence" icon={ShieldCheck}>
      <KpiRow label="Objectif" value={formatEuros(kpis.emergencyTarget)} />
      <KpiRow label="Objectif atteint en" value={emergencyReachedText(kpis)} />
    </KpiCard>
  );
}

function DebtCard({ kpis }: { kpis: PlanKpis }) {
  return (
    <KpiCard title="Dettes" icon={CreditCard}>
      <KpiRow label="Sans dette en" value={debtFreeText(kpis)} />
      {kpis.hasDebt ? (
        <>
          <KpiRow label="Intérêts sans le plan" value={formatEuros(kpis.interestWithoutPlan)} />
          <KpiRow label="Intérêts avec le plan" value={formatEuros(kpis.interestWithPlan)} />
          <KpiRow
            label="Intérêts économisés"
            value={formatEuros(kpis.interestSaved)}
            tone={kpis.interestSaved > 0 ? "good" : undefined}
            hint="Avant éventuelles IRA (indemnités de remboursement anticipé)."
          />
        </>
      ) : null}
    </KpiCard>
  );
}

function HorizonCard({ kpis, month12 }: { kpis: PlanKpis; month12: PlanMonth | undefined }) {
  return (
    <KpiCard title={month12 ? `Horizon 12 mois (${formatMonthLong(month12.month)})` : "Horizon 12 mois"} icon={Hourglass}>
      <KpiRow label="Épargne libre" value={formatEuros(kpis.freeSavingsAt12)} />
      <KpiRow label="Fonds d’urgence" value={formatEuros(kpis.emergencyFundAt12)} />
      <KpiRow label="Dette restante" value={kpis.hasDebt ? formatEuros(kpis.remainingDebtAt12) : "Aucune dette"} />
    </KpiCard>
  );
}

function GapValue({ gap, tone }: { gap: number | null; tone: GapTone | null }) {
  if (gap === null || tone === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${GAP_TONE[tone]}`}>
      {tone === "good" ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleAlert aria-hidden className="size-3.5" />}
      {formatSignedEuros(gap)}
      <span className="sr-only">{tone === "good" ? "(dans la tolérance)" : "(hors tolérance)"}</span>
    </span>
  );
}

function LatestActualCard({ latest }: { latest: ActualComparison | null }) {
  const footer = (
    <Link href="/suivi" className={`${LINK_CLASS} mt-auto w-fit text-sm`}>
      Saisir le mois
    </Link>
  );
  if (!latest) {
    return (
      <KpiCard title="Dernier suivi" icon={CalendarCheck} footer={footer}>
        <KpiRow label="Statut" value={<span className="font-normal text-muted-foreground">Aucune saisie</span>} />
      </KpiCard>
    );
  }
  return (
    <KpiCard title="Dernier suivi" icon={CalendarCheck} footer={footer}>
      <KpiRow label="Mois" value={formatMonthLong(latest.month)} />
      <KpiRow label="Statut" value={<StatusBadge status={latest.status} />} />
      <KpiRow
        label="Écart dette"
        value={<GapValue gap={latest.debtGap} tone={debtGapTone(latest.debtGap)} />}
        hint="Réel − prévu. Bon si ≤ +10 €."
      />
      <KpiRow
        label="Écart épargne"
        value={<GapValue gap={latest.savingsGap} tone={savingsGapTone(latest.savingsGap)} />}
        hint="Réel − prévu. Bon si ≥ −10 €."
      />
    </KpiCard>
  );
}

