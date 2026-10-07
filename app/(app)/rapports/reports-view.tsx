"use client";

import { Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useFinance } from "@/components/app/finance-provider";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { openPaywall } from "@/lib/billing/paywall";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { NO_TAG, type LineReport, REPORT_MONTHS, lineReports, reportMonths, tagTotals, tagsInUse } from "@/lib/domain/reports";
import type { BudgetLine } from "@/lib/domain/types";
import { errorMessage, reportError } from "@/lib/errors";
import { currentYearMonth, formatEuros, formatMonthLong, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const TITLE = "Rapports";
const DESCRIPTION = `Votre réel comparé au budget, ligne par ligne, sur les ${REPORT_MONTHS} derniers mois.`;

/**
 * Pro reports (issue #145, US-8): actual vs budget per line over 12 months, recurring overspends,
 * totals per tag, and the tags of the lines. Free: one card that opens the paywall.
 */
export function ReportsView() {
  const { snapshot } = useFinance();
  const [filter, setFilter] = useState(ALL);
  const filterId = useId();

  if (snapshot.isPro === false) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <section className="flex max-w-2xl flex-col items-start gap-3 rounded-2xl border bg-card p-5">
          <p className="flex items-center gap-2 font-semibold">
            <Lock aria-hidden className="size-4.5" />
            Réservé à Boussole Pro
          </p>
          <p className="text-sm text-muted-foreground">
            Étiquetez vos lignes (Logement, Loisirs…), repérez les dépassements qui reviennent et suivez le réel contre le budget sur 12 mois.
          </p>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => openPaywall("tags_limit")}>
            Découvrir Boussole Pro
          </Button>
        </section>
      </>
    );
  }

  const months = reportMonths(currentYearMonth());
  const all = lineReports(snapshot.actuals, snapshot.lines, months.at(-1)!);
  const tags = tagsInUse(snapshot.lines);
  const reports = filter === ALL ? all : all.filter((r) => (r.tag ?? NO_TAG) === filter);
  const recurring = all.filter((r) => r.recurring);

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />

      {all.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
          Aucun suivi détaillé sur les {REPORT_MONTHS} derniers mois : saisissez vos mois ligne par ligne dans Suivi.
        </p>
      ) : (
        <>
          {recurring.length > 0 ? (
            <section aria-label="Dépassements récurrents" className="flex flex-col gap-1.5 rounded-2xl border border-warning-border bg-warning-bg p-4 text-sm text-warning">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert aria-hidden className="size-4" />
                Dépassements récurrents
              </p>
              <ul className="list-disc pl-5">
                {recurring.map((r) => (
                  <li key={r.key}>
                    {r.label} : {r.direction === "expense" ? "au-dessus" : "en dessous"} du budget {r.offMonths} mois sur {REPORT_MONTHS}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <TagTotalsTable reports={all} />

          <section aria-labelledby="report-lines-title" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="report-lines-title" className="text-[17px] font-semibold">
                Par ligne
              </h2>
              <label htmlFor={filterId} className="flex items-center gap-2 text-sm font-medium">
                Étiquette
                <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)} className="min-h-11 rounded-[10px] border border-input bg-card px-3 text-sm">
                  <option value={ALL}>Toutes</option>
                  {[...tags, NO_TAG].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <LinesTable reports={reports} months={months} />
          </section>
        </>
      )}

      <MonthlyReports months={snapshot.actuals.map((a) => a.month)} />

      <LineTags lines={snapshot.lines} tags={tags} />
    </>
  );
}

/** One printable report per check-in (newest first), saved as PDF from the browser. */
function MonthlyReports({ months }: { months: string[] }) {
  if (months.length === 0) return null;
  return (
    <section aria-labelledby="report-months-title" className="flex max-w-3xl flex-col gap-3">
      <h2 id="report-months-title" className="text-[17px] font-semibold">
        Rapport mensuel (PDF)
      </h2>
      <ul className="flex flex-wrap gap-2">
        {[...months].sort().reverse().map((m) => (
          <li key={m}>
            <Link
              href={`/rapports/mois/?mois=${m}`}
              className="inline-flex min-h-11 items-center rounded-[10px] border border-input bg-card px-3.5 text-sm font-medium first-letter:uppercase hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {formatMonthLong(m)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TagTotalsTable({ reports }: { reports: LineReport[] }) {
  const totals = tagTotals(reports);
  if (totals.length === 0) return null;
  return (
    <section aria-labelledby="report-tags-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="report-tags-title" className="text-[17px] font-semibold">
        Dépenses par étiquette
      </h2>
      <Table label="Dépenses par étiquette sur 12 mois">
        <TableHeader>
          <TableRow>
            <TableHead>Étiquette</TableHead>
            <TableHead className="text-right">Budget</TableHead>
            <TableHead className="text-right">Réel</TableHead>
            <TableHead className="text-right">Écart</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((t) => {
            const gap = t.actual - t.planned;
            return (
              <TableRow key={t.tag}>
                <TableCell className="font-medium">{t.tag}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuros(t.planned)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuros(t.actual)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", gap > 0 ? "text-bad" : "text-good")}>
                  {gap > 0 ? "+" : ""}
                  {formatEuros(gap)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function LinesTable({ reports, months }: { reports: LineReport[]; months: string[] }) {
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">Aucune ligne pour cette étiquette.</p>;
  return (
    <Table label={`Réel par ligne et par mois, ${REPORT_MONTHS} derniers mois`}>
      <TableHeader>
        <TableRow>
          <TableHead>Ligne</TableHead>
          {months.map((m) => (
            <TableHead key={m} className="text-right">
              {formatMonthShort(m)}
            </TableHead>
          ))}
          <TableHead className="text-right">Total réel</TableHead>
          <TableHead className="text-right">Total budget</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reports.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="min-w-44">
              <span className="block font-medium">{r.label}</span>
              <span className="text-xs text-muted-foreground">
                {r.tag ?? NO_TAG}
                {r.recurring ? " · dépassement récurrent" : ""}
              </span>
            </TableCell>
            {r.cells.map((c, i) => (
              <TableCell key={months[i]} className={cn("text-right tabular-nums", c?.off && "font-semibold text-bad")}>
                {c ? (
                  <>
                    {formatEuros(c.actual)}
                    {c.off ? <span className="sr-only"> (hors budget : {formatEuros(c.planned)} prévus)</span> : null}
                  </>
                ) : (
                  <span aria-label="Pas de suivi" className="text-faint">
                    —
                  </span>
                )}
              </TableCell>
            ))}
            <TableCell className="text-right font-semibold tabular-nums">{formatEuros(r.totalActual)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{formatEuros(r.totalPlanned)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** One tag per budget line, saved line by line (Pro; refused by the database otherwise). */
function LineTags({ lines, tags }: { lines: BudgetLine[]; tags: string[] }) {
  const listId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ id: string; message: string; error: boolean } | null>(null);

  async function save(line: BudgetLine) {
    const value = (drafts[line.id] ?? line.tag ?? "").trim();
    if (value.length > 30) return setStatus({ id: line.id, message: "30 caractères au maximum.", error: true });
    try {
      await getRepository().setLineTag(line.id, value || null);
      setStatus({ id: line.id, message: value ? `« ${line.label} » : ${value}` : `« ${line.label} » : sans étiquette`, error: false });
      notifyDataChanged();
    } catch (saveError) {
      reportError(saveError, "reports.tag");
      setStatus({ id: line.id, message: errorMessage(saveError, "L’étiquette n’a pas été enregistrée. Réessayez."), error: true });
    }
  }

  if (lines.length === 0) return null;
  return (
    <section aria-labelledby="report-line-tags-title" className="flex max-w-3xl flex-col gap-3">
      <h2 id="report-line-tags-title" className="text-[17px] font-semibold">
        Étiquettes des lignes
      </h2>
      <p className="text-sm text-muted-foreground">Une étiquette par ligne pour regrouper vos dépenses ; le calcul du plan ne change pas.</p>
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <ul className="flex flex-col divide-y divide-divider rounded-2xl border bg-card">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <label htmlFor={`tag-${line.id}`} className="min-w-40 grow text-sm">
              {line.label}
            </label>
            <input
              id={`tag-${line.id}`}
              list={listId}
              maxLength={30}
              value={drafts[line.id] ?? line.tag ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [line.id]: e.target.value }))}
              placeholder="ex. Logement"
              className="h-10 w-44 rounded-[10px] border border-input bg-card px-3 text-sm"
            />
            <Button type="button" variant="outline" className="min-h-10" onClick={() => void save(line)} aria-label={`Enregistrer l’étiquette de « ${line.label} »`}>
              Enregistrer
            </Button>
            {status?.id === line.id ? (
              <p role={status.error ? "alert" : "status"} className={cn("basis-full text-sm", status.error ? "text-bad" : "text-good")}>
                {status.message}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
