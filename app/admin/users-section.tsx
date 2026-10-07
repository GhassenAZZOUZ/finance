"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADMIN_ERRORS, type PlanLabel, type UserPage, type UserRow, callAdmin } from "@/lib/admin/client";

const PLANS: PlanLabel[] = ["Pro payant", "Essai", "Pro offert", "Free"];
const STATUSES: { value: string; label: string }[] = [
  { value: "trialing", label: "Essai" },
  { value: "active", label: "Actif" },
  { value: "past_due", label: "Impayé (délai de grâce)" },
  { value: "canceled", label: "Résilié" },
  { value: "cancel_scheduled", label: "Résiliation programmée" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(new Date(iso)) : "—");

function statusText(r: UserRow): string {
  if (!r.status) return "—";
  const base = STATUS_LABEL[r.status] ?? r.status;
  return r.cancelAtPeriodEnd && r.status !== "canceled" ? `${base}, résiliation programmée` : base;
}

/**
 * Back-office user list (issue #157, US-14): account and subscription information only, plus the
 * number of loans and goals. Search, filters, sort, 50 per page, CSV export (audited).
 */
export function UsersSection() {
  const id = useId();
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created");
  const [pageNo, setPageNo] = useState(1);
  const [result, setResult] = useState<UserPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useCallback(() => ({ search, plan: plan || null, status: status || null, sort }), [search, plan, status, sort]);

  useEffect(() => {
    let live = true;
    // Typing in the search waits a little before asking the server.
    const start = setTimeout(() => {
      void callAdmin<UserPage>({ action: "users.list", ...query(), page: pageNo }).then((r) => {
        if (!live) return;
        if (r.ok) {
          setResult(r.data);
          setError(null);
        } else setError(ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(start);
    };
  }, [query, pageNo]);

  async function exportCsv() {
    setExporting(true);
    const r = await callAdmin<{ csv: string; count: number }>({ action: "users.export", ...query() });
    setExporting(false);
    if (!r.ok) return setError(ADMIN_ERRORS[r.error] ?? ADMIN_ERRORS.failed!);
    const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `boussole-utilisateurs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const filter = (setter: (v: string) => void) => (e: { target: { value: string } }) => {
    setter(e.target.value);
    setPageNo(1);
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold">
          Utilisateurs{result ? ` (${result.total})` : ""}
        </h2>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void exportCsv()} disabled={exporting}>
          <Download aria-hidden />
          {exporting ? "Export…" : "Exporter en CSV"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Rechercher (e-mail)
          <input type="search" value={search} onChange={filter(setSearch)} className="h-11 w-64 rounded-[10px] border border-input bg-card px-3 font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Plan
          <select value={plan} onChange={filter(setPlan)} className="h-11 rounded-[10px] border border-input bg-card px-3 font-normal">
            <option value="">Tous</option>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Statut d’abonnement
          <select value={status} onChange={filter(setStatus)} className="h-11 rounded-[10px] border border-input bg-card px-3 font-normal">
            <option value="">Tous</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Tri
          <select value={sort} onChange={filter(setSort)} className="h-11 rounded-[10px] border border-input bg-card px-3 font-normal">
            <option value="created">Inscription la plus récente</option>
            <option value="last_sign_in">Dernière connexion</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      {result === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : result.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun compte ne correspond.</p>
      ) : (
        <>
          <Table label="Liste des utilisateurs">
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Inscription</TableHead>
                <TableHead>Dernière connexion</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Abonnement</TableHead>
                <TableHead>Fin de période</TableHead>
                <TableHead className="text-right">Crédits</TableHead>
                <TableHead className="text-right">Objectifs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">{r.email}</TableCell>
                  <TableCell className="tabular-nums">{day(r.createdAt)}</TableCell>
                  <TableCell className="tabular-nums">{day(r.lastSignInAt)}</TableCell>
                  <TableCell>{r.plan}</TableCell>
                  <TableCell>{statusText(r)}</TableCell>
                  <TableCell className="tabular-nums">{day(r.currentPeriodEnd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.loans}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.goals}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.pages > 1 ? (
            <nav aria-label="Pages de la liste" className="flex items-center gap-2 text-sm">
              <Button type="button" variant="outline" className="min-h-10" disabled={result.page <= 1} onClick={() => setPageNo(result.page - 1)}>
                Précédente
              </Button>
              <span className="tabular-nums">
                Page {result.page} sur {result.pages}
              </span>
              <Button type="button" variant="outline" className="min-h-10" disabled={result.page >= result.pages} onClick={() => setPageNo(result.page + 1)}>
                Suivante
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
