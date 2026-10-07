"use client";

import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPaywall } from "@/lib/billing/paywall";
import { CARD } from "./styles";

/**
 * Free plan (issue #145, owner decision 2026-10-07): the dashboard's projections (plan charts,
 * « Où va le revenu » over 12 months) are Pro, like the Plan page beyond 3 months. One card instead.
 */
export function LockedProjections() {
  return (
    <section aria-labelledby="locked-projections-title" className={`${CARD} flex flex-col items-start gap-3`}>
      <h2 id="locked-projections-title" className="flex items-center gap-2 text-[17px] font-semibold">
        <Lock aria-hidden className="size-4.5" />
        Vos projections sur 2 ans
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Dettes et épargne mois par mois, intérêts évités, ordre de remboursement des crédits, où va votre revenu sur 12 mois : avec Boussole Pro.
      </p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => openPaywall("plan_limit")}>
        Découvrir Boussole Pro
      </Button>
    </section>
  );
}
