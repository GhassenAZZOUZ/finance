"use client";

import { CreditCard } from "lucide-react";
import Link from "next/link";
import type { PaymentProblem } from "@/lib/domain/types";
import { isNativeApp } from "@/lib/native/platform";

const longDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

/**
 * Failed Stripe payment (issue #144, US-7; owner decisions 2026-10-09): on every page, not
 * dismissible, until the payment is settled. « grace »: Pro until the grace end; « lapsed »: back to
 * Free (grace over, or a trial ending unpaid). The link opens Stripe's page to pay the invoice (it
 * also handles 3-D Secure). In the Android app there is no payment link (Google Play rules): it says
 * to pay from the website.
 */
export function PaymentBanner({ problem }: { problem: PaymentProblem }) {
  const native = isNativeApp();
  const message =
    problem.kind === "grace"
      ? `Le paiement de votre abonnement Pro a échoué. Pro reste actif${problem.graceEndsAt ? ` jusqu’au ${longDate.format(new Date(problem.graceEndsAt))}` : ""} : réglez le paiement d’ici là.`
      : "Le paiement de votre abonnement Pro n’a pas abouti : votre compte est repassé en Free. Vos données sont conservées.";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning"
    >
      <span className="flex items-start gap-2">
        <CreditCard aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>Paiement échoué.</strong> {message}
          {native ? " Réglez-le depuis le site Boussole." : ""}
        </span>
      </span>
      {native ? null : problem.paymentUrl ? (
        <a href={problem.paymentUrl} target="_blank" rel="noreferrer" className="min-h-10 content-center font-medium underline underline-offset-2">
          Régler le paiement
        </a>
      ) : (
        <Link href="/abonnement" className="min-h-10 content-center font-medium underline underline-offset-2">
          {problem.kind === "grace" ? "Gérer mon abonnement" : "Voir l’offre Pro"}
        </Link>
      )}
    </div>
  );
}
