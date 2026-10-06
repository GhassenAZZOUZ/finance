"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchEntitlement } from "@/lib/billing/client";

/** How often and how long the page waits for the webhook. */
export const POLL_MS = 2000;
export const POLL_ATTEMPTS = 15;

/**
 * After Stripe Checkout (issue #141, US-4): the payment page does not grant Pro, the webhook does
 * (US-5). This page waits until the rights say Pro, then confirms; after ~30 s it says so and
 * offers to check again.
 */
export function CheckoutSuccess() {
  const [state, setState] = useState<"waiting" | "pro" | "slow">("waiting");
  const live = useRef(true);

  const poll = useCallback(async () => {
    for (let attempt = 0; attempt < POLL_ATTEMPTS && live.current; attempt++) {
      const entitlement = await fetchEntitlement().catch(() => null);
      if (!live.current) return;
      if (entitlement?.isPro) {
        setState("pro");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (live.current) setState("slow");
  }, []);

  useEffect(() => {
    live.current = true;
    const start = setTimeout(() => void poll(), 0);
    return () => {
      live.current = false;
      clearTimeout(start);
    };
  }, [poll]);

  if (state === "pro") {
    return (
      <section role="status" className="flex max-w-xl flex-col gap-3 rounded-2xl border border-good-border bg-good-bg p-5 text-good">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles aria-hidden className="size-5" />
          Bienvenue dans Boussole Pro !
        </p>
        <p className="text-sm">Toutes les fonctionnalités Pro sont actives.</p>
        <Link href="/" className="self-start font-medium underline underline-offset-2">
          Aller au tableau de bord
        </Link>
      </section>
    );
  }
  if (state === "slow") {
    return (
      <section role="status" className="flex max-w-xl flex-col gap-3 rounded-2xl border bg-card p-5 text-sm">
        <p>Votre paiement est enregistré par Stripe ; l’activation de Pro prend un peu plus de temps que prévu.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-start"
          onClick={() => {
            setState("waiting");
            void poll();
          }}
        >
          Vérifier à nouveau
        </Button>
      </section>
    );
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Activation de votre abonnement…
    </p>
  );
}
