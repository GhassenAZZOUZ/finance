"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatMonthLong } from "@/lib/format";
import { deleteActualAction } from "./actions";

/** "Supprimer" with an inline confirmation step (no window.confirm). */
export function DeleteActualButton({ month }: { month: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const label = formatMonthLong(month);

  // Move focus into the confirmation, and back to the trigger when it closes.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteActualAction(month);
      if (!result.ok) setError(result.message);
    });
  }

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="min-h-11 md:min-h-9"
        onClick={() => setConfirming(true)}
        aria-label={`Supprimer la saisie de ${label}`}
      >
        <Trash2 aria-hidden />
        Supprimer
      </Button>
    );
  }

  return (
    <div role="group" aria-label={`Confirmer la suppression de ${label}`} className="flex flex-col gap-2">
      <p className="text-sm font-medium">Supprimer la saisie de {label} ? Cette action est définitive.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" className="min-h-11 md:min-h-9" disabled={pending} onClick={confirm}>
          {pending ? "Suppression…" : "Confirmer la suppression"}
        </Button>
        <Button ref={cancelRef} type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={pending} onClick={() => setConfirming(false)}>
          Annuler
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
