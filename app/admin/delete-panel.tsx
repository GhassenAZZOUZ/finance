"use client";

import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ADMIN_ERRORS, type UserRow, callAdmin } from "@/lib/admin/client";

const normalize = (email: string) => email.trim().toLowerCase();

/**
 * Delete an account at its owner's request (issue #159, US-16). Owner decisions 2026-10-07: the
 * admin types the account's e-mail (case and surrounding spaces ignored) and a reference of the
 * request; an active Stripe subscription is cancelled first, without refund; the user receives a
 * confirmation e-mail. Only account and subscription information is shown.
 */
export function DeletePanel({ user, onDeleted }: { user: UserRow; onDeleted: (message: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [requestRef, setRequestRef] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = user.email !== null && normalize(typed) === normalize(user.email);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || requestRef.trim() === "") return;
    setPending(true);
    setError(null);
    const r = await callAdmin<{ deleted: true; subscriptionCancelled: boolean; emailSent: boolean }>({
      action: "users.delete",
      userId: user.userId,
      confirmEmail: typed,
      requestRef,
    });
    setPending(false);
    if (!r.ok) return setError(r.error === "user_not_found" ? "Ce compte n’existe plus." : (ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!));
    onDeleted(
      [
        `Le compte ${user.email} est supprimé.`,
        r.data.subscriptionCancelled ? "Son abonnement Stripe est résilié." : null,
        r.data.emailSent ? "Un e-mail de confirmation lui a été envoyé." : "L’e-mail de confirmation n’a pas pu être envoyé.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="min-h-11 self-start text-destructive" onClick={() => setOpen(true)}>
        Supprimer le compte
      </Button>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-2xl border border-destructive p-4">
      <h3 id={`${id}-title`} className="font-semibold text-destructive">
        Supprimer le compte
      </h3>
      <p className="text-sm">
        La suppression est <strong>définitive</strong> : le compte et toutes ses données sont effacés.
        {user.stripeCustomerId ? " Un abonnement Stripe en cours est résilié immédiatement, sans remboursement." : ""} L’utilisateur reçoit un e-mail de confirmation.
      </p>
      <label htmlFor={`${id}-ref`} className="text-sm font-medium">
        Référence de la demande (obligatoire)
      </label>
      <input
        id={`${id}-ref`}
        value={requestRef}
        maxLength={200}
        onChange={(e) => setRequestRef(e.target.value)}
        placeholder="ex. e-mail reçu le 7 octobre 2026"
        className="h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
      />
      <label htmlFor={`${id}-email`} className="text-sm font-medium">
        Pour confirmer, saisissez {user.email}
      </label>
      <input
        id={`${id}-email`}
        type="email"
        autoComplete="off"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className="h-11 rounded-[10px] border border-input bg-card px-3 text-sm"
      />
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <span className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" className="min-h-11" disabled={pending || !matches || requestRef.trim() === ""}>
          {pending ? "Suppression…" : "Supprimer définitivement"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)} disabled={pending}>
          Annuler
        </Button>
      </span>
    </form>
  );
}
