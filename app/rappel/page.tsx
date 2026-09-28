import type { Metadata } from "next";
import { Suspense } from "react";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Rappel mensuel · Plan financier" };

/** Public page (no login): the unsubscribe link of the monthly reminder e-mail. */
export default function ReminderPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rappel mensuel</h1>
        <p className="mt-1 text-sm text-muted-foreground">Le rappel de fin de mois pour saisir votre suivi.</p>
      </div>
      {/* useSearchParams (?jeton) needs a Suspense boundary in a static export. */}
      <Suspense>
        <Unsubscribe />
      </Suspense>
    </main>
  );
}
