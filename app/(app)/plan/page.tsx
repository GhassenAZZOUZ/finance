import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanView } from "./view";

export const metadata: Metadata = { title: "Plan · Cap" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return (
    // ?mois= is read in the browser (static export): useSearchParams needs a Suspense boundary.
    <Suspense>
      <PlanView />
    </Suspense>
  );
}
