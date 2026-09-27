"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { type DeleteLoanState, deleteLoan } from "./actions";

/** Two-step delete: "Supprimer" reveals an explicit confirmation (no window.confirm). */
export function DeleteLoanButton({
  loanId,
  loanName,
  onDeleted,
}: {
  loanId: string;
  loanName: string;
  onDeleted: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteLoanState, FormData>(
    async (prev, formData) => {
      const next = await deleteLoan(prev, formData);
      if (next.status === "success") onDeleted(next.message);
      return next;
    },
    { status: "idle" },
  );

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        className="min-h-10 px-3"
        onClick={() => setConfirming(true)}
        aria-label={`Supprimer « ${loanName} »`}
      >
        Supprimer
      </Button>
    );
  }

  const errorId = `supprimer-${loanId}-erreur`;
  return (
    <form
      action={formAction}
      role="group"
      aria-label={`Confirmer la suppression de « ${loanName} »`}
      className="flex max-w-44 flex-col gap-2 whitespace-normal rounded-md border border-bad-border bg-bad-bg p-2 text-sm text-bad"
    >
      <input type="hidden" name="id" value={loanId} />
      <p>
        Supprimer « {loanName} » ? S’il a un historique de suivi, il sera archivé au lieu d’être supprimé.
      </p>
      {state.status === "error" ? (
        <p id={errorId} role="alert" className="font-medium text-bad">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="h-auto min-h-10 whitespace-normal bg-bad px-3 py-1 text-white hover:bg-bad/90"
          aria-describedby={state.status === "error" ? errorId : undefined}
        >
          {pending ? "Suppression…" : "Confirmer la suppression"}
        </Button>
        <Button type="button" variant="outline" autoFocus className="min-h-10 px-3" onClick={() => setConfirming(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
