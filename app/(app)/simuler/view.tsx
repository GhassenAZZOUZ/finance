"use client";

import { useMemo } from "react";
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
  if (!base) {
    return (
      <>
        <PageHeader title="Et si… ?" />
        <Onboarding hasBudget={false} loanCount={snapshot.loans.length} />
      </>
    );
  }
  // A reload of the saved data (e.g. from another tab) restarts the simulation from it.
  return <Simulator key={JSON.stringify(base)} base={base} currentMonth={currentMonth} />;
}
