"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";

/**
 * Monthly check-in reminder by e-mail (issue #6, SPEC D25): on by default; sent on the last day of
 * the month (evening, Paris) when that month's check-in is not entered yet.
 */
export function ReminderCard() {
  const { snapshot, email } = useFinance();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = snapshot.reminderEnabled;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await getRepository().setReminder(next);
      notifyDataChanged();
    } catch {
      setError("Le changement n’a pas été enregistré. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail aria-hidden className="size-5 shrink-0" />
          <h2>Rappel mensuel</h2>
        </CardTitle>
        <CardDescription>
          Le dernier jour du mois, en fin de journée, un e-mail vous rappelle de saisir votre suivi s’il n’est pas encore fait. Il ne
          contient aucun montant.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
            className="size-5 accent-primary"
          />
          <span>
            Recevoir le rappel{email ? <span className="text-muted-foreground"> à {email}</span> : null}
          </span>
        </label>
        {error ? (
          <p role="alert" className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
