"use client";

import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RebasePlan } from "@/lib/domain/rebase";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
import { rebasePlanAction } from "./actions";

export interface RebaseCardProps {
  /** What "Recaler le plan" would change; null when there is nothing to re-base. */
  preview: RebasePlan | null;
  /** Current plan start month (before re-basing). */
  startMonth: YearMonth;
  /** Display name of each active loan, by id. */
  loanLabels: Record<string, string>;
}

type Outcome = { ok: true; newStartMonth: YearMonth } | { ok: false; message: string };

/**
 * "Recaler le plan" (issue #5): previews the new start month and balances taken from the latest
 * check-in, then applies them after an inline confirmation step (no window.confirm).
 * Stays mounted after success (the preview becomes null) so the confirmation message remains visible.
 */
export function RebaseCard({ preview, startMonth, loanLabels }: RebaseCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const wasConfirming = useRef(false);

  // Focus the confirmation when it opens; back to the trigger when cancelled; on the message after success.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) (outcome?.ok ? successRef.current : triggerRef.current)?.focus();
    wasConfirming.current = confirming;
  }, [confirming, outcome]);

  if (!preview && !outcome?.ok) return null;

  function confirm() {
    setOutcome(null);
    startTransition(async () => {
      const result = await rebasePlanAction();
      setOutcome(result);
      if (result.ok) setConfirming(false);
    });
  }

  const loanName = (id: string) => loanLabels[id] ?? "Crédit";

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw aria-hidden className="size-5 shrink-0" />
          <h2 id="suivi-rebase-title">Recaler le plan</h2>
        </CardTitle>
        <CardDescription>
          Si vos soldes réels s’écartent durablement du plan, faites repartir le plan de votre dernière saisie.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {preview ? (
          <>
            <div className="flex flex-col gap-2">
              <p>
                Votre plan repartira de <strong>{formatMonthLong(preview.newStartMonth)}</strong> avec vos soldes réels de{" "}
                <strong>{formatMonthLong(preview.fromMonth)}</strong> :
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {preview.goalUpdates.map(({ id, draft }) => (
                  <li key={id} className="break-words">
                    épargne {draft.name.toLocaleLowerCase("fr")} <Amount cents={draft.alreadySaved} />
                  </li>
                ))}
                <li>
                  fonds d’urgence <Amount cents={preview.settings.emergencyExisting} />
                </li>
                <li>
                  épargne libre <Amount cents={preview.settings.freeSavingsExisting} />
                </li>
                {preview.loanUpdates.length + preview.loansToArchive.length > 0 ? (
                  <li>
                    capital restant dû par crédit :
                    <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-5">
                      {preview.loanUpdates.map(({ id, draft }) => (
                        <li key={id} className="break-words">
                          {loanName(id)} : <Amount cents={draft.principal} />
                        </li>
                      ))}
                      {preview.loansToArchive.map((id) => (
                        <li key={id} className="break-words">
                          {loanName(id)} : <span className="font-medium">soldé, sera archivé</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null}
              </ul>
              <p className="text-muted-foreground">
                Les mois déjà saisis gardent les valeurs prévues avec lesquelles ils ont été comparés.
              </p>
            </div>

            {confirming ? (
              <div role="group" aria-label="Confirmer le recalage du plan" className="flex flex-col gap-3 rounded-md border border-warning-border bg-warning-bg p-3 text-warning">
                <p className="font-medium">Recaler le plan ?</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  <li>
                    Le début du plan passe de {formatMonthLong(startMonth)} à {formatMonthLong(preview.newStartMonth)}.
                  </li>
                  <li>
                    Les montants déjà épargnés et le capital restant dû des crédits sont remplacés par vos soldes de{" "}
                    {formatMonthLong(preview.fromMonth)}.
                  </li>
                  {preview.loansToArchive.length > 0 ? (
                    <li>
                      {preview.loansToArchive.length === 1 ? "Le crédit soldé est archivé." : "Les crédits soldés sont archivés."}
                    </li>
                  ) : null}
                  <li>Les mois déjà saisis restent comparés à l’ancien plan.</li>
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11 md:min-h-9" disabled={pending} onClick={confirm}>
                    {pending ? "Recalage…" : "Confirmer le recalage"}
                  </Button>
                  <Button
                    ref={cancelRef}
                    type="button"
                    variant="outline"
                    className="min-h-11 md:min-h-9"
                    disabled={pending}
                    onClick={() => {
                      setOutcome(null);
                      setConfirming(false);
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button ref={triggerRef} type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={() => {
                    setOutcome(null);
                    setConfirming(true);
                  }}
                >
                  Recaler le plan…
                </Button>
              </div>
            )}
          </>
        ) : null}

        <div aria-live="polite" className="empty:hidden">
          {outcome?.ok ? (
            <p
              ref={successRef}
              tabIndex={-1}
              role="status"
              className="flex items-center gap-2 rounded-md border border-good-border bg-good-bg px-3 py-2 font-medium text-good outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <CheckCircle2 aria-hidden className="size-4 shrink-0" />
              Plan recalé : il démarre en {formatMonthLong(outcome.newStartMonth)}.
            </p>
          ) : null}
          {outcome && !outcome.ok ? (
            <p role="alert" className="flex items-center gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-bad">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {outcome.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Amount({ cents }: { cents: number }) {
  return <span className="font-medium tabular-nums whitespace-nowrap">{formatEuros(cents)}</span>;
}
