"use client";

import { CheckCircle2, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type RebasePlan, rebaseFields } from "@/lib/domain/rebase";
import type { Loan, RebaseUndo } from "@/lib/domain/types";
import type { Errors } from "@/lib/domain/validation";
import type { YearMonth } from "@/lib/engine";
import { amountInputValue, formatEuros, formatMonthLong } from "@/lib/format";
import { rebasePlanAction, undoRebaseAction } from "./actions";

export interface RebaseCardProps {
  /** What "Recaler le plan" would change; null when there is nothing to re-base. */
  preview: RebasePlan | null;
  /** Current plan start month (before re-basing). */
  startMonth: YearMonth;
  /** Display name of each active loan, by id. */
  loanLabels: Record<string, string>;
  /** Active loans, to correct a loan's principal in the preview (#100). */
  loans?: readonly Loan[];
  /** The latest re-base while it can still be undone (#100). */
  undo?: RebaseUndo | null;
}

type Outcome =
  | { ok: true; kind: "rebase"; newStartMonth: YearMonth }
  | { ok: true; kind: "undo" }
  | { ok: false; message: string };

/**
 * "Recaler le plan" (issue #5): previews the new start month and balances taken from the latest
 * check-in, lets them be corrected by hand, then applies them after an inline confirmation step (no
 * window.confirm). « Annuler le recalage » (#100) puts the plan back while the re-base can be undone.
 * Stays mounted after success (the preview becomes null) so the confirmation message remains visible.
 */
export function RebaseCard({ preview, startMonth, loanLabels, loans = [], undo = null }: RebaseCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);

  // Focus the confirmation when it opens; back to the trigger when cancelled; on the message after success.
  const open = confirming || undoing;
  useEffect(() => {
    if (open) cancelRef.current?.focus();
    else if (wasOpen.current) (outcome?.ok ? successRef.current : triggerRef.current)?.focus();
    wasOpen.current = open;
  }, [open, outcome]);

  if (!preview && !undo && !outcome?.ok) return null;

  const loanName = (id: string) => loanLabels[id] ?? "Crédit";
  const fields = preview ? rebaseFields(preview, loans, loanName) : [];

  function startConfirm() {
    setOutcome(null);
    setErrors({});
    setTyped(Object.fromEntries(fields.map((f) => [f.key, amountInputValue(f.read)])));
    setConfirming(true);
  }

  function confirm() {
    setOutcome(null);
    startTransition(async () => {
      const result = await rebasePlanAction(typed);
      if (result.ok) {
        setOutcome({ ok: true, kind: "rebase", newStartMonth: result.newStartMonth });
        setConfirming(false);
      } else {
        setErrors(result.errors ?? {});
        setOutcome(result);
      }
    });
  }

  function confirmUndo() {
    setOutcome(null);
    startTransition(async () => {
      const result = await undoRebaseAction();
      setOutcome(result.ok ? { ok: true, kind: "undo" } : result);
      if (result.ok) setUndoing(false);
    });
  }

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
                    {formatMonthLong(preview.fromMonth)}, corrigeables ci-dessous.
                  </li>
                  {preview.loansToArchive.length > 0 ? (
                    <li>
                      {preview.loansToArchive.length === 1 ? "Le crédit soldé est archivé." : "Les crédits soldés sont archivés."}
                    </li>
                  ) : null}
                  <li>Les mois déjà saisis restent comparés à l’ancien plan.</li>
                </ul>
                <fieldset className="flex flex-col gap-2 text-foreground">
                  <legend className="mb-1 text-sm font-medium text-warning">Valeurs de départ (en euros)</legend>
                  {fields.map((f) => {
                    const id = `rebase-${f.key.replace(":", "-")}`;
                    const error = errors[f.key];
                    return (
                      <div key={f.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center sm:gap-3">
                        <Label htmlFor={id} className="break-words">
                          {f.label}
                        </Label>
                        <Input
                          id={id}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          className="h-10 bg-background tabular-nums"
                          value={typed[f.key] ?? ""}
                          onChange={(e) => setTyped((t) => ({ ...t, [f.key]: e.target.value }))}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${id}-error` : undefined}
                        />
                        {error ? (
                          <p id={`${id}-error`} className="text-bad sm:col-span-2">
                            {error}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </fieldset>
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
                <Button ref={triggerRef} type="button" variant="outline" className="min-h-11 md:min-h-9" onClick={startConfirm}>
                  Recaler le plan…
                </Button>
              </div>
            )}
          </>
        ) : null}

        {undo && !preview ? (
          <div className="flex flex-col gap-3">
            <p>
              Le plan a été recalé sur vos soldes de <strong>{formatMonthLong(undo.fromMonth)}</strong> : il démarre en{" "}
              <strong>{formatMonthLong(undo.newStartMonth)}</strong>. Vous pouvez revenir en arrière tant que vous n’avez ni saisi
              de mois ni modifié le budget.
            </p>
            {undoing ? (
              <div role="group" aria-label="Confirmer l’annulation du recalage" className="flex flex-col gap-3 rounded-md border border-warning-border bg-warning-bg p-3 text-warning">
                <p className="font-medium">Annuler le recalage ?</p>
                <p>
                  Le plan, les crédits, les objectifs et les mois figés reviennent exactement à leur état d’avant le recalage.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11 md:min-h-9" disabled={pending} onClick={confirmUndo}>
                    {pending ? "Annulation…" : "Confirmer l’annulation"}
                  </Button>
                  <Button
                    ref={cancelRef}
                    type="button"
                    variant="outline"
                    className="min-h-11 md:min-h-9"
                    disabled={pending}
                    onClick={() => {
                      setOutcome(null);
                      setUndoing(false);
                    }}
                  >
                    Garder le recalage
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button
                  ref={triggerRef}
                  type="button"
                  variant="outline"
                  className="min-h-11 md:min-h-9"
                  onClick={() => {
                    setOutcome(null);
                    setUndoing(true);
                  }}
                >
                  <RotateCcw aria-hidden />
                  Annuler le recalage…
                </Button>
              </div>
            )}
          </div>
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
              {outcome.kind === "rebase"
                ? `Plan recalé : il démarre en ${formatMonthLong(outcome.newStartMonth)}.`
                : "Recalage annulé : le plan est revenu à son état d’avant."}
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
