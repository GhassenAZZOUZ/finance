import type { Metadata } from "next";
import { SubscriptionView } from "./subscription-view";

export const metadata: Metadata = { title: "Boussole Pro · Boussole" };

/** Static shell; the rights are read in the browser (entitlements, SPEC D35). */
export default function Page() {
  return <SubscriptionView />;
}
