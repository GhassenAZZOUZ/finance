"use client";

import { ExternalLink } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ADMIN_ERRORS, type UserRow, callAdmin } from "@/lib/admin/client";

const day = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(iso));
/** The included last day of an offer: its expiry is the next midnight in Paris. */
const lastDay = (expiresAt: string) => day(new Date(new Date(expiresAt).getTime() - 1).toISOString());

/**
 * « Gérer » a user's plan (issue #158, US-15): offer Pro (mandatory reason, optional end date
 * included until 23:59 Paris time, confirmation when already Pro) or remove an offered Pro. A Stripe
 * subscription is not changed here: a link opens it in Stripe. No e-mail to the user.
 */
export function PlanPanel({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [alreadyPro, setAlreadyPro] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function grant(confirm: boolean) {
    setPending(true);
    setMessage(null);
    const r = await callAdmin<{ granted: true }>({ action: "plan.grant", userId: user.userId, reason, endsOn, confirm });
    setPending(false);
    if (!r.ok && r.error === "already_pro") return setAlreadyPro(user.plan);
    setAlreadyPro(null);
    if (!r.ok) return setMessage({ text: ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!, error: true });
    setMessage({ text: endsOn ? `Pro offert jusqu’au ${day(`${endsOn}T12:00:00Z`)} inclus.` : "Pro offert, sans date de fin.", error: false });
    setReason("");
    setEndsOn("");
    onChanged();
  }

  async function revoke() {
    setRevoking(false);
    const r = await callAdmin({ action: "plan.revoke", userId: user.userId, reason });
    if (!r.ok) return setMessage({ text: ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!, error: true });
    setMessage({ text: "Pro offert retiré.", error: false });
    onChanged();
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void grant(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Plan</dt>
        <dd>{user.plan}</dd>
        <dt className="text-muted-foreground">Pro offert</dt>
        <dd>
          {user.grantReason
            ? `${user.grantReason === "early_user" ? "au lancement" : "par un admin"}, ${user.grantExpiresAt ? `jusqu’au ${lastDay(user.grantExpiresAt)} inclus` : "sans date de fin"}`
            : "non"}
        </dd>
        <dt className="text-muted-foreground">Abonnement Stripe</dt>
        <dd>
          {user.stripeCustomerId ? (
            <a
              href={`https://dashboard.stripe.com/customers/${user.stripeCustomerId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-link underline underline-offset-2"
            >
              Ouvrir dans Stripe
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          ) : (
            "aucun"
          )}
        </dd>
      </dl>

      {message ? (
        <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-bad" : "text-sm text-good"}>
          {message.text}
        </p>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-2xl border p-4">
        <h3 className="font-semibold">Offrir Pro</h3>
        <label htmlFor={`${id}-reason`} className="text-sm font-medium">
          Motif (obligatoire)
        </label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ex. geste commercial après un incident"
          className="min-h-20 rounded-[10px] border border-input bg-card px-3 py-2 text-sm"
        />
        <label htmlFor={`${id}-end`} className="text-sm font-medium">
          Jusqu’au (inclus, facultatif)
        </label>
        <input id={`${id}-end`} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="h-11 w-48 rounded-[10px] border border-input bg-card px-3 text-sm" />
        {alreadyPro ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-warning-border bg-warning-bg p-3 text-sm text-warning">
            <p>Ce compte est déjà « {alreadyPro} ». Offrir Pro quand même ?{user.grantReason ? " La nouvelle date de fin remplacera l’actuelle." : ""}</p>
            <span className="flex gap-2">
              <Button type="button" className="min-h-10" onClick={() => void grant(true)} disabled={pending}>
                Confirmer
              </Button>
              <Button type="button" variant="ghost" className="min-h-10" onClick={() => setAlreadyPro(null)}>
                Annuler
              </Button>
            </span>
          </div>
        ) : (
          <Button type="submit" className="min-h-11 self-start" disabled={pending || reason.trim() === ""}>
            {pending ? "Enregistrement…" : "Offrir Pro"}
          </Button>
        )}
      </form>

      {user.grantReason ? (
        <div className="flex flex-col gap-2">
          {revoking ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Retirer le Pro offert ? Un abonnement Stripe n’est pas touché.
              <Button type="button" variant="destructive" className="min-h-10" onClick={() => void revoke()}>
                Confirmer le retrait
              </Button>
              <Button type="button" variant="ghost" className="min-h-10" onClick={() => setRevoking(false)}>
                Annuler
              </Button>
            </span>
          ) : (
            <Button type="button" variant="outline" className="min-h-11 self-start text-destructive" onClick={() => setRevoking(true)}>
              Retirer le Pro offert
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
