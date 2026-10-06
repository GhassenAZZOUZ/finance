"use client";

import { Check, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { CHECKOUT_MESSAGES, type Entitlement, PLANS, type Plan, TRIAL_DAYS, createCheckout, fetchEntitlement } from "@/lib/billing/client";
import { reportError } from "@/lib/errors";
import { isNativeApp } from "@/lib/native/platform";
import { cn } from "@/lib/utils";

const PRO_FEATURES = [
  "Crédits et objectifs d’épargne illimités",
  "Plan sur 25 ans et tout l’historique du suivi",
  "Rapports et tendances",
  "Export PDF",
];

/** Long date of a period end: « 15 mars 2027 ». */
const endDate = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(iso));

/**
 * « Boussole Pro » (issue #141, US-4): the current rights, and for a Free user the two plans and
 * Stripe Checkout. In the Android app no purchase is offered (Google Play billing rules).
 */
export function SubscriptionView() {
  const [entitlement, setEntitlement] = useState<Entitlement | null | undefined>(undefined);
  const [plan, setPlan] = useState<Plan>("yearly");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = useId();

  useEffect(() => {
    let live = true;
    fetchEntitlement()
      .then((e) => live && setEntitlement(e))
      .catch((loadError: unknown) => {
        reportError(loadError, "billing.entitlement");
        if (live) setEntitlement(null);
      });
    return () => {
      live = false;
    };
  }, []);

  async function subscribe() {
    setPending(true);
    setError(null);
    const result = await createCheckout(plan);
    if ("url" in result) {
      window.location.assign(result.url);
      return;
    }
    setError(CHECKOUT_MESSAGES[result.error]);
    setPending(false);
  }

  const header = <PageHeader title="Boussole Pro" description="Tout Boussole, sans limite, pour piloter votre budget sur la durée." />;

  if (entitlement === undefined) {
    return (
      <>
        {header}
        <p role="status" className="text-sm text-muted-foreground">
          Chargement de votre abonnement…
        </p>
      </>
    );
  }

  if (entitlement?.isPro) {
    return (
      <>
        {header}
        <section aria-label="Votre abonnement" className="flex max-w-2xl flex-col gap-2 rounded-2xl border border-good-border bg-good-bg p-5 text-good">
          <p className="flex items-center gap-2 font-semibold">
            <Sparkles aria-hidden className="size-5" />
            Vous êtes abonné à Boussole Pro{entitlement.status === "trialing" ? " (période d’essai)" : ""}.
          </p>
          {entitlement.currentPeriodEnd ? (
            <p className="text-sm">
              {entitlement.cancelAtPeriodEnd
                ? `Résilié : Pro reste actif jusqu’au ${endDate(entitlement.currentPeriodEnd)}.`
                : `Prochain renouvellement le ${endDate(entitlement.currentPeriodEnd)}.`}
            </p>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <>
      {header}
      <ul className="flex max-w-2xl flex-col gap-2 text-[15px]">
        {PRO_FEATURES.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <Check aria-hidden className="size-4 shrink-0 text-good" />
            {f}
          </li>
        ))}
      </ul>

      {isNativeApp() ? (
        <p className="max-w-2xl rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          L’abonnement n’est pas proposé dans l’application Android. Une fois abonné, Pro est actif ici aussi avec le même compte.
        </p>
      ) : (
        <section aria-label="Choisir une formule" className="flex max-w-2xl flex-col gap-4">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Formule</legend>
            {(Object.keys(PLANS) as Plan[]).map((p) => (
              <label
                key={p}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-2xl border bg-card p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  plan === p && "border-foreground ring-1 ring-foreground",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{PLANS[p].label}</span>
                  <input type="radio" name={name} value={p} checked={plan === p} onChange={() => setPlan(p)} className="size-4 accent-primary" />
                </span>
                <span className="font-heading text-2xl font-medium">{PLANS[p].price}</span>
                <span className="text-sm text-muted-foreground">{PLANS[p].detail}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {entitlement === null ? `${TRIAL_DAYS} jours d’essai gratuit, puis ` : ""}
            {PLANS[plan].price} {PLANS[plan].detail.split(",")[0]}. Sans engagement : résiliable à tout moment, Pro reste actif jusqu’à la fin de la
            période payée.
          </p>
          {error ? (
            <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
              {error}
            </p>
          ) : null}
          <Button type="button" className="min-h-12 self-start px-6 text-[15px]" onClick={() => void subscribe()} disabled={pending}>
            {pending ? "Redirection vers le paiement…" : entitlement === null ? `Essayer ${TRIAL_DAYS} jours gratuitement` : "S’abonner"}
          </Button>
          <p className="text-[13px] text-muted-foreground">Paiement sécurisé par Stripe. Boussole ne voit jamais votre carte.</p>
        </section>
      )}
    </>
  );
}
