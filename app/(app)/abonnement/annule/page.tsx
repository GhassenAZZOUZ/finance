import type { Metadata } from "next";
import { ArrowLink } from "@/components/app/nav";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Abonnement · Boussole" };

/** Stripe Checkout left without paying (issue #141, US-4): nothing was charged. */
export default function Page() {
  return (
    <>
      <PageHeader title="Paiement annulé" description="Aucun montant n’a été prélevé. Vous pouvez reprendre quand vous voulez." />
      <ArrowLink href="/abonnement">Revoir les formules</ArrowLink>
    </>
  );
}
