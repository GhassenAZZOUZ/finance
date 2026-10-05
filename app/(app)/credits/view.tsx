"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { PageHeader } from "@/components/app/page-header";
import { useIsMobile } from "@/components/app/use-is-mobile";
import { Button } from "@/components/ui/button";
import { MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import { type Cents, monthsBetween } from "@/lib/engine";
import { currentYearMonth, formatEuros, formatMonthLong, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LoansManager } from "./loans-manager";
import { buildLoanRows, computeLoanTotals, timelineScale } from "./loan-view";
import { MobileCredits } from "./mobile-credits";

export function CreditsView() {
  const { snapshot, plan } = useFinance();
  const isMobile = useIsMobile();
  const rows = buildLoanRows(snapshot.loans, plan);
  const totals = computeLoanTotals(snapshot.loans, plan);
  const archived = snapshot.archivedLoans;
  const canAdd = rows.length < MAX_ACTIVE_LOANS;

  // Plan balances in the reference month (the KPIs' month), by loan id.
  const refRow = plan ? plan.result.months[monthsBetween(plan.input.budget.startMonth, plan.referenceMonth)] : undefined;
  const balances = new Map<string, Cents>(
    plan && refRow ? plan.input.loans.map((l, j) => [l.id, refRow.loans[j]?.endBalance ?? l.principal]) : [],
  );
  const k = plan?.result.kpis;

  // Phones get their own layout (#112); only one of the two is mounted, so the form ids stay unique.
  if (isMobile) {
    return (
      <MobileCredits
        rows={rows}
        archived={archived}
        balances={balances}
        totals={{
          remainingDebt: refRow ? refRow.remainingDebt : totals.totalPrincipal,
          monthlyPayments: totals.monthlyPayments,
          weightedApr: totals.weightedApr,
          interestSaved: k ? k.interestSaved : null,
        }}
        riskFreeRate={plan ? plan.input.budget.riskFreeRate : null}
        currentMonth={currentYearMonth()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Crédits"
        description="Vos crédits en cours et l’ordre de remboursement anticipé (méthode avalanche : le TAEG le plus élevé d’abord)."
        actions={
          <div className="flex flex-col items-start gap-1.5 md:items-end">
            {canAdd ? (
              <Button
                type="button"
                className="min-h-11 px-4.5 text-[15px]"
                onClick={() => {
                  document.getElementById("formulaire-credit")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  document.getElementById("credit-name")?.focus({ preventScroll: true });
                }}
              >
                <Plus aria-hidden />
                Ajouter un crédit
              </Button>
            ) : (
              <Button type="button" className="min-h-11 px-4.5 text-[15px]" disabled aria-describedby="max-note">
                <Plus aria-hidden />
                Ajouter un crédit
              </Button>
            )}
            <span id="max-note" className="text-[13px] text-muted-foreground">
              {rows.length} crédit{rows.length > 1 ? "s" : ""} sur {MAX_ACTIVE_LOANS} au maximum
            </span>
          </div>
        }
      />

      {plan ? null : (
        <p className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
          <Link href="/budget" className="font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Renseignez le budget
          </Link>{" "}
          pour voir les priorités et les dates de fin.
        </p>
      )}

      {rows.length > 0 ? (
        <section aria-label="Totaux" className="grid grid-cols-2 gap-2.5 md:gap-4 xl:grid-cols-4">
          <TotalTile
            label="Capital restant dû"
            value={formatEuros(refRow ? refRow.remainingDebt : totals.totalPrincipal)}
            hint={refRow ? `${formatEuros(totals.totalPrincipal)} au début du plan` : "tel que saisi"}
          />
          <TotalTile
            label="Mensualités"
            value={formatEuros(totals.monthlyPayments)}
            hint={k && k.monthlyIncome > 0 ? `${formatPercent(k.debtRatio, 1)} des revenus` : "par mois"}
          />
          <TotalTile
            label="TAEG moyen pondéré"
            value={formatPercent(totals.weightedApr)}
            hint={plan ? `taux seuil : ${formatPercent(plan.input.budget.riskFreeRate)}` : undefined}
          />
          {k ? (
            <TotalTile
              label="Intérêts économisés"
              value={formatEuros(k.interestSaved)}
              hint={`${formatEuros(k.interestWithPlan)} avec le plan contre ${formatEuros(k.interestWithoutPlan)} sans${
                k.penaltiesPaid > 0 ? `, moins ${formatEuros(k.penaltiesPaid)} d’IRA` : ""
              }`}
              good={k.interestSaved > 0}
            />
          ) : null}
        </section>
      ) : null}

      <LoansManager
        rows={rows}
        hasPlan={plan !== null}
        currentMonth={currentYearMonth()}
        balances={balances}
        scale={plan ? timelineScale(rows, plan.input.budget.startMonth) : null}
        referenceMonth={plan?.referenceMonth ?? null}
      />

      <p className="max-w-3xl text-[13px] leading-normal text-muted-foreground">
        {plan ? `Restant dû = projection du plan pour ${formatMonthLong(plan.referenceMonth)}. ` : null}
        TAEG : taux annuel effectif global, indiqué sur l’offre de prêt ou le relevé annuel. Seuls les crédits au-dessus du
        taux seuil reçoivent du remboursement anticipé. Les indemnités (IRA) saisies sur un crédit sont payées sur le
        budget de remboursement anticipé ; un crédit dont les IRA dépassent les intérêts évités n’en reçoit pas.
      </p>

      {archived.length > 0 ? (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Crédits archivés ({archived.length})
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Crédits supprimés alors qu’ils avaient un historique de suivi : conservés pour l’historique, exclus du plan.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {archived.map((loan, i) => (
              <li key={loan.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-divider pb-2 last:border-b-0">
                <span className="font-medium">
                  {loan.name?.trim() || `Crédit archivé ${i + 1}`}
                  {loan.type ? <span className="font-normal text-muted-foreground"> · {loan.type}</span> : null}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEuros(loan.principal)} · {formatPercent(loan.apr)} · {formatEuros(loan.monthlyPayment)}/mois
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function TotalTile({ label, value, hint, good = false }: { label: string; value: ReactNode; hint?: ReactNode; good?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border bg-card px-4 py-4 md:px-5.5 md:py-5", good && "border-good-border bg-good-bg")}>
      <h2 className={cn("text-[13px] font-medium tracking-[0.02em]", good ? "text-good" : "text-muted-foreground")}>{label}</h2>
      <p className={cn("font-heading text-2xl leading-none font-medium tabular-nums md:text-[34px]", good && "text-link")}>{value}</p>
      {hint ? <p className="text-[13px] text-muted-foreground tabular-nums">{hint}</p> : null}
    </div>
  );
}
