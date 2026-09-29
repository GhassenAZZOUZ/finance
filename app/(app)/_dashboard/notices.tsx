/** Dashboard alerts: negative budget months, primary goal shortfall. */
import { CircleAlert, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
import type { MovingShortfall } from "./logic";

export function NegativeBudgetNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Alert variant="destructive" className="rounded-2xl border-bad-border bg-bad-bg px-4 py-3">
      <CircleAlert aria-hidden />
      <AlertTitle className="text-bad">{count} mois en budget négatif</AlertTitle>
      <AlertDescription className="text-bad">
        Ces mois-là, revenus moins dépenses et mensualités sont négatifs : rien n’est épargné.{" "}
        <Link href="/plan?mois=300" className="font-medium underline underline-offset-4">
          Voir le plan mois par mois
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/* ---------------------------------------------------------------------------------- Stat tiles */

export function MovingAlert({
  shortfall: s,
  referenceMonth,
  goalName,
}: {
  shortfall: MovingShortfall;
  referenceMonth: YearMonth;
  /** The primary goal's name (SPEC D23). */
  goalName: string;
}) {
  const optionClass =
    "flex min-h-11 flex-col gap-1 rounded-xl border border-warning-border bg-card px-4 py-3.5 text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <section
      aria-labelledby="moving-alert-title"
      className="grid gap-4 rounded-2xl border border-warning-border bg-warning-bg p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,35rem)] xl:items-center xl:gap-8"
    >
      <div className="flex gap-4">
        <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-bucket-moving/30 text-warning md:flex">
          <TriangleAlert aria-hidden className="size-5" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 id="moving-alert-title" className="text-base font-semibold text-warning md:text-lg">
            {goalName} : il manquera {formatEuros(s.shortfall)} fin {formatMonthLong(s.deadlineMonth)}
          </h2>
          <p className="text-sm leading-relaxed text-warning tabular-nums">
            Au rythme actuel, le fonds atteindra {formatEuros(s.amountAtDeadline)} à la date limite, pour un objectif de{" "}
            {formatEuros(s.goal)}.{" "}
            {s.extraPerMonth !== null || s.deadlineThatWorks ? "Pour le tenir :" : "Ajustez l’objectif ou la date limite dans le budget."}
          </p>
        </div>
      </div>
      {s.extraPerMonth !== null || s.deadlineThatWorks ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {s.extraPerMonth !== null ? (
            <li>
              <Link href="/budget" className={optionClass}>
                <span className="text-[15px] font-semibold tabular-nums">+{formatEuros(s.extraPerMonth)} / mois</span>
                <span className="text-[13px] text-muted-foreground">
                  de moins en dépenses,{" "}
                  {s.monthsLeft === 1
                    ? `en ${formatMonthLong(s.deadlineMonth)}`
                    : `de ${formatMonthLong(referenceMonth).replace(/ \d{4}$/, "")} à ${formatMonthLong(s.deadlineMonth)}`}
                </span>
              </Link>
            </li>
          ) : null}
          {s.deadlineThatWorks ? (
            <li>
              <Link href="/budget" className={optionClass}>
                <span className="text-[15px] font-semibold">Date limite en {formatMonthLong(s.deadlineThatWorks)}</span>
                <span className="text-[13px] text-muted-foreground">l’objectif est atteint ce mois-là</span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------------------------ Roadmap */
