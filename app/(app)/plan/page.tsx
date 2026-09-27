import { CircleCheck, Flag, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { loadPageData } from "@/lib/data/session";
import { HORIZON_MONTHS } from "@/lib/engine";
import { formatMonthLong } from "@/lib/format";
import { DEFAULT_ROW_COUNT, findMilestones, parseRowCount } from "./milestones";
import { PlanTable } from "./plan-table";

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const [{ snapshot, plan }, query] = await Promise.all([loadPageData(), searchParams]);
  if (!plan) {
    return (
      <>
        <PageHeader title="Plan mois par mois" />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }

  const milestones = findMilestones(plan.input, plan.result);
  const rowCount = parseRowCount(query.mois);
  const showAll = rowCount === HORIZON_MONTHS;
  const months = plan.result.months.slice(0, rowCount);

  return (
    <>
      <PageHeader
        title="Plan mois par mois"
        description="Chaque ligne = 1 mois. L'argent disponible est réparti dans l'ordre ① → ② → ③ → ④. Pour changer le résultat, modifiez Budget ou Crédits."
      />

      {milestones.negativeCount > 0 && milestones.firstNegativeMonth ? (
        <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-900">
          <TriangleAlert aria-hidden />
          <AlertTitle>
            {milestones.negativeCount} mois en budget négatif (premier : {formatMonthLong(milestones.firstNegativeMonth)})
          </AlertTitle>
          <AlertDescription className="text-red-900">
            Vos dépenses dépassent vos revenus : ces mois-là rien n&apos;est épargné.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="plan-legend" className="flex flex-col gap-2 text-sm">
        <h2 id="plan-legend" className="font-medium">
          Légende
        </h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <LegendItem swatch="bg-[#9C4409] text-white" icon={<CircleCheck aria-hidden className="size-3.5" />}>
            Premier mois où un objectif est atteint (déménagement, fonds d&apos;urgence, plus de dettes)
          </LegendItem>
          <LegendItem swatch="bg-[#C65911]/15">Objectif déjà atteint (mois suivants)</LegendItem>
          <LegendItem swatch="border border-[#A00000] bg-white text-[#A00000]" icon={<CircleCheck aria-hidden className="size-3.5" />}>
            Crédit soldé ce mois-ci
          </LegendItem>
          <LegendItem swatch="text-[#9C4409]" icon={<Flag aria-hidden className="size-3.5" />}>
            Date limite du déménagement
          </LegendItem>
          <LegendItem swatch="bg-red-100 text-red-800" icon={<TriangleAlert aria-hidden className="size-3.5" />}>
            Budget négatif : rien n&apos;est épargné ce mois-là
          </LegendItem>
        </ul>
      </section>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground">
            {showAll ? `Les ${HORIZON_MONTHS} mois du plan (25 ans).` : `Les ${DEFAULT_ROW_COUNT} premiers mois sur ${HORIZON_MONTHS}.`}
          </p>
          <Link
            href={showAll ? "/plan" : `/plan?mois=${HORIZON_MONTHS}`}
            scroll={false}
            className="inline-flex min-h-10 items-center rounded-md border px-3 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {showAll ? `Afficher ${DEFAULT_ROW_COUNT} mois` : `Afficher les ${HORIZON_MONTHS} mois`}
          </Link>
        </div>
        <PlanTable
          months={months}
          milestones={milestones}
          caption={`Plan mois par mois, ${months.length} mois à partir de ${formatMonthLong(plan.input.budget.startMonth)}`}
        />
      </div>
    </>
  );
}

function LegendItem({ swatch, icon, children }: { swatch: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`inline-flex h-5 w-8 shrink-0 items-center justify-center rounded ${swatch}`}>
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}
