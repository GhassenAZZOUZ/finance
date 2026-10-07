import type { Metadata } from "next";
import { Suspense } from "react";
import { MonthReport } from "./month-report";

export const metadata: Metadata = { title: "Rapport mensuel · Boussole" };

/** `?mois=AAAA-MM`; useSearchParams needs a Suspense boundary in a static export. */
export default function Page() {
  return (
    <Suspense>
      <MonthReport />
    </Suspense>
  );
}
