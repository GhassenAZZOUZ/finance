import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { CheckoutSuccess } from "./checkout-success";

export const metadata: Metadata = { title: "Abonnement · Boussole" };

export default function Page() {
  return (
    <>
      <PageHeader title="Merci !" />
      <CheckoutSuccess />
    </>
  );
}
