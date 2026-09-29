/** Order in which the loans are repaid. */
import { ArrowLink } from "@/components/app/nav";
import type { ComputedPlan } from "@/lib/domain/plan";
import { formatEuros, formatMonthShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CARD } from "./styles";

export function RepaymentOrder({ plan }: { plan: ComputedPlan }) {
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
