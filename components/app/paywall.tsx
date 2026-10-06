"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { track } from "@/lib/analytics";
import { CHECKOUT_MESSAGES, PLANS, TRIAL_DAYS, createCheckout } from "@/lib/billing/client";
import { PAYWALL_COPY, type PaywallReason, onPaywall } from "@/lib/billing/paywall";
import { isNativeApp } from "@/lib/native/platform";

/**
 * The paywall (issue #140, US-3): shown when a Free limit is reached (a write refused by the
 * database, or more history / plan than Free shows), never at sign-up. It says which limit, and
 * goes to Stripe Checkout (yearly plan, trial) or to the plans; in the Android app, no purchase.
 */
export function PaywallHost() {
  const [reason, setReason] = useState<PaywallReason | null>(null);
  useEffect(
    () =>
      onPaywall((next) => {
        setReason(next);
        track({ name: "paywall_viewed", reason: next });
      }),
    [],
  );
  return <Paywall reason={reason} onClose={() => setReason(null)} />;
}

export function Paywall({ reason, onClose }: { reason: PaywallReason | null; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = reason ? PAYWALL_COPY[reason] : null;

  async function subscribe() {
    setPending(true);
    setError(null);
    const result = await createCheckout("yearly");
    if ("url" in result) {
      window.location.assign(result.url);
      return;
    }
    setError(CHECKOUT_MESSAGES[result.error]);
    setPending(false);
  }

  return (
    <Sheet
      open={copy !== null}
      title={copy?.title ?? ""}
      onClose={() => {
        setError(null);
        onClose();
      }}
    >
      {copy ? (
        <div className="flex flex-col gap-4 pb-2">
          <p className="flex items-start gap-2 text-[15px]">
            <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-bucket-moving" />
            {copy.text}
          </p>
          {isNativeApp() ? (
            <p className="text-sm text-muted-foreground">
              L’abonnement n’est pas proposé dans l’application Android. Une fois abonné, Pro est actif ici aussi avec le même compte.
            </p>
          ) : (
            <>
              {error ? (
                <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
                  {error}
                </p>
              ) : null}
              <Button type="button" className="min-h-12 text-[15px]" onClick={() => void subscribe()} disabled={pending}>
                {pending ? "Redirection vers le paiement…" : `Essayer Pro ${TRIAL_DAYS} jours gratuitement`}
              </Button>
              <p className="text-center text-[13px] text-muted-foreground">
                Puis {PLANS.yearly.price} {PLANS.yearly.detail}, ou {PLANS.monthly.price} {PLANS.monthly.detail}. Sans engagement.{" "}
                <Link href="/abonnement" onClick={onClose} className="font-medium text-link underline underline-offset-2">
                  Voir les formules
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}
