import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { loadPageData } from "@/lib/data/session";
import { MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import { formatEuros, formatPercent } from "@/lib/format";
import { LoansManager } from "./loans-manager";
import { buildLoanRows, computeLoanTotals } from "./loan-view";

export const metadata: Metadata = { title: "Crédits · Plan financier" };

export default async function CreditsPage() {
  const { snapshot, plan } = await loadPageData();
  const rows = buildLoanRows(snapshot.loans, plan);
  const totals = computeLoanTotals(snapshot.loans, plan);
  const archived = snapshot.archivedLoans;

  return (
    <>
      <PageHeader
        title="Crédits"
        description={`Vos crédits en cours (${MAX_ACTIVE_LOANS} au maximum) et l’ordre de remboursement anticipé.`}
      />

      {plan ? null : (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <Link href="/budget" className="font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Renseignez le budget
          </Link>{" "}
          pour voir les priorités et les dates de fin.
        </p>
      )}

      <LoansManager rows={rows} totals={totals} hasPlan={plan !== null} />

      <p className="text-sm text-muted-foreground">
        TAEG : taux annuel effectif global, indiqué sur l’offre de prêt ou le relevé annuel. Priorité 1 = crédit à
        rembourser par anticipation en premier (TAEG le plus élevé, au-dessus du taux seuil).
      </p>

      {archived.length > 0 ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Crédits archivés ({archived.length})
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">
            Crédits supprimés alors qu’ils avaient un historique de suivi : conservés pour l’historique, exclus du plan.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {archived.map((loan, i) => (
              <li key={loan.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b pb-2 last:border-b-0">
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
