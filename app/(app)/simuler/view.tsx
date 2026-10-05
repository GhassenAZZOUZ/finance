"use client";

import { useMemo, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useFinance } from "@/components/app/finance-provider";
import { Onboarding } from "@/components/app/onboarding";
import { PageHeader } from "@/components/app/page-header";
import { currentYearMonth } from "@/lib/format";
import { simulationBase } from "./logic";
import { Simulator } from "./simulator";

export function SimulerView() {
  const { snapshot } = useFinance();
  const currentMonth = currentYearMonth();
  const base = useMemo(() => simulationBase(snapshot, currentMonth), [snapshot, currentMonth]);
  // « Appliquer au plan » (#98): the simulator remounts on the new plan, so the message lives here.
  const [applied, setApplied] = useState(false);
  if (!base) {
    return (
      <>
        <PageHeader title="Et si… ?" />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }
  return (
    <>
      {applied ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          Simulation appliquée : votre plan est à jour.
        </p>
      ) : null}
      {/* A reload of the saved data (after « Appliquer », or from another tab) restarts the simulation from it. */}
      <Simulator key={JSON.stringify(base)} base={base} currentMonth={currentMonth} onApplied={() => setApplied(true)} />
    </>
  );
}
