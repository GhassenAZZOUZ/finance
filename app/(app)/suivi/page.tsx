import type { Metadata } from "next";
import { Suspense } from "react";
import { SuiviView } from "./view";

export const metadata: Metadata = { title: "Suivi mensuel · Cap" };

/** Static shell; the user's data is loaded in the browser (FinanceProvider). */
export default function Page() {
  return (
    // ?mois= is read in the browser (static export): useSearchParams needs a Suspense boundary.
    <Suspense>
      <SuiviView />
    </Suspense>
  );
}
