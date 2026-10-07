"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ADMIN_ERRORS, type DashboardFigures, type MonthFigures, type PlanLabel, callAdmin } from "@/lib/admin/client";

const euros = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function Month({ title, m }: { title: string; m: MonthFigures }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <h3 className="font-semibold">
        {title} <span className="font-normal text-muted-foreground">({monthLabel(m.month)})</span>
      </h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Inscriptions</dt>
        <dd className="text-right tabular-nums">{m.signups}</dd>
        <dt>Nouveaux abonnements payants</dt>
        <dd className="text-right tabular-nums">{m.newSubscriptions}</dd>
        <dt>Résiliations (fin d’accès)</dt>
        <dd className="text-right tabular-nums">{m.cancellations}</dd>
      </dl>
    </div>
  );
}

/**
 * Admin dashboard (issue #160, US-17): account and subscription counts only, computed by the server
 * (definitions in SPEC D37, shared with US-10). The grace-period figure opens the filtered list.
 */
export function DashboardSection({ onShowList }: { onShowList: (plan: PlanLabel, status: string) => void }) {
  const id = useId();
  const [figures, setFigures] = useState<DashboardFigures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Bumped by « Réessayer »: the figures load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void callAdmin<DashboardFigures>({ action: "dashboard" }).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) {
        setFigures(r.data);
        setError(null);
      } else {
        // No outdated figures presented as current (AC-10).
        setFigures(null);
        setError(ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!);
      }
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoading(true);
    setAttempt((a) => a + 1);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3">
      <h2 id={`${id}-title`} className="text-[17px] font-semibold">
        Tableau de bord
      </h2>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bad">
          {error}
          <Button type="button" variant="outline" className="min-h-10" onClick={retry} disabled={loading}>
            <RefreshCw aria-hidden />
            Réessayer
          </Button>
        </div>
      ) : figures === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Figure label="Utilisateurs" value={figures.users} hint={`dont ${figures.activeLast30Days} actifs sur 30 jours`} />
            <Figure label="Abonnés Pro (payants)" value={figures.paying} />
            <Figure label="Essais en cours" value={figures.trials} />
            <Figure label="Pro offerts" value={figures.offered} />
            <Figure label="Revenu mensuel estimé" value={euros(figures.mrrCents)} hint="abonnés payants × prix ; le montant exact est dans Stripe" />
            <div className="flex flex-col gap-0.5 rounded-2xl border bg-card p-4">
              <dt className="text-sm text-muted-foreground">Paiement échoué, en délai de grâce</dt>
              <dd className="text-2xl font-semibold tabular-nums">{figures.inGrace}</dd>
              <dd>
                <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => onShowList("Pro payant", "past_due")}>
                  Voir ces comptes
                </Button>
              </dd>
            </div>
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <Month title="Ce mois-ci" m={figures.current} />
            <Month title="Mois précédent" m={figures.previous} />
          </div>
        </>
      )}
    </section>
  );
}
