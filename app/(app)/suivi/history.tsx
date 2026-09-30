import { CheckCircle2, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { VerdictBadge, VerdictDetail } from "@/components/app/verdict-badge";
import { verdictOf } from "@/lib/domain/verdict";
import { STATUS_LABEL } from "@/lib/labels";
import { GAP_TONE } from "@/components/app/tones";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Cents } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DeleteActualButton } from "./delete-actual-button";
import { type HistoryEntry, isDebtGapGood, isSavingsGapGood } from "./logic";

function signedEuros(cents: Cents): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

const optionalEuros = (cents: Cents | null) => (cents === null ? "—" : formatEuros(cents));

/** Gap with colour + icon + screen-reader text, so colour is never the only cue. */
function Gap({ gap, good, prefix }: { gap: Cents | null; good: (gap: Cents) => boolean; prefix?: string }) {
  if (gap === null) return <span className="text-muted-foreground">{prefix ? `${prefix} —` : "—"}</span>;
  const ok = good(gap);
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 font-medium tabular-nums whitespace-nowrap ${ok ? GAP_TONE.good : GAP_TONE.bad}`}>
      <Icon aria-hidden className={`${prefix ? "size-3.5" : "size-4"} shrink-0`} />
      {prefix ? `${prefix} ` : null}
      {signedEuros(gap)}
      <span className="sr-only">{ok ? "(dans la tolérance)" : "(hors tolérance)"}</span>
    </span>
  );
}

function Meter({ label, shortLabel, value }: { label: string; shortLabel?: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{shortLabel ?? label}</span>
        <span className="font-medium tabular-nums">{formatPercent(value, 0)}</span>
      </div>
      <Progress value={percent} aria-label={label} className="h-2" />
    </div>
  );
}

/** Desktop cell: actual amount, planned amount and gap stacked on three short lines. */
function Comparison({
  actual,
  planned,
  gap,
  good,
  actualWord,
  plannedWord,
}: {
  actual: Cents;
  planned: Cents | null;
  gap: Cents | null;
  good: (gap: Cents) => boolean;
  actualWord: string;
  plannedWord: string;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 tabular-nums whitespace-nowrap">
      <span>
        <span className="font-medium">{formatEuros(actual)}</span> <span className="text-xs text-muted-foreground">{actualWord}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {optionalEuros(planned)} {plannedWord}
      </span>
      <span className="text-xs">
        <Gap gap={gap} good={good} prefix="écart" />
      </span>
    </div>
  );
}

/** Actual income/expenses vs budget: information only, not part of the status (SPEC §8.1). */
function BudgetInfo({ actual, comparison, stacked = false }: HistoryEntry & { stacked?: boolean }) {
  const items = [
    { label: "Revenus", value: actual?.income ?? null, gap: comparison.incomeGap },
    { label: "Dépenses", value: actual?.expenses ?? null, gap: comparison.expensesGap },
  ].filter((i) => i.value !== null);
  if (items.length === 0) return <span className="text-muted-foreground">Non renseigné</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => (
        <li key={i.label}>
          {i.label} : <span className="tabular-nums whitespace-nowrap">{optionalEuros(i.value)}</span>
          {i.gap !== null ? (
            <span className={`text-muted-foreground tabular-nums whitespace-nowrap ${stacked ? "block" : ""}`}>
              {stacked ? `écart ${signedEuros(i.gap)}` : ` (écart ${signedEuros(i.gap)})`}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Plan version a frozen check-in was compared with (SPEC D16); nothing for entries saved before D16. */
function PlanVersion({ entry, className }: { entry: HistoryEntry; className: string }) {
  const planStart = entry.actual?.frozen?.planStartMonth;
  if (!planStart) return null;
  return <span className={`text-xs font-normal text-muted-foreground ${className}`}>Comparé au plan démarrant en {formatMonthShort(planStart)}</span>;
}

export function History({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune saisie pour l’instant. Enregistrez votre premier mois ci-dessus.</p>;
  }
  return (
    <>
      {/* Below lg: one card per month (the table needs ≈ 960 px to fit without scrolling). */}
      <ul className="grid gap-3 md:grid-cols-2 xl:hidden">
        {entries.map((entry) => {
          const c = entry.comparison;
          const verdict = entry.actual ? verdictOf(entry.actual) : null;
          return (
            <li key={c.month} className="rounded-2xl border bg-card p-4">
              <article aria-labelledby={`suivi-card-${c.month}`} className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 id={`suivi-card-${c.month}`} className="font-semibold first-letter:uppercase">
                      {formatMonthLong(c.month)}
                    </h3>
                    <VerdictBadge verdict={verdict} />
                  </div>
                  <PlanVersion entry={entry} className="block" />
                </div>
                {verdict ? <VerdictDetail verdict={verdict} /> : null}
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Trajectoire :</span>
                  <StatusBadge status={c.status} />
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Dettes réelles</dt>
                  <dd className="text-right tabular-nums">{formatEuros(c.actualDebt)}</dd>
                  <dt className="text-muted-foreground">Dettes prévues</dt>
                  <dd className="text-right tabular-nums">{optionalEuros(c.plannedDebt)}</dd>
                  <dt className="text-muted-foreground">Écart dettes</dt>
                  <dd className="text-right">
                    <Gap gap={c.debtGap} good={isDebtGapGood} />
                  </dd>
                  <dt className="mt-2 text-muted-foreground">Épargne réelle</dt>
                  <dd className="mt-2 text-right tabular-nums">{formatEuros(c.actualSavings)}</dd>
                  <dt className="text-muted-foreground">Épargne prévue</dt>
                  <dd className="text-right tabular-nums">{optionalEuros(c.plannedSavings)}</dd>
                  <dt className="text-muted-foreground">Écart épargne</dt>
                  <dd className="text-right">
                    <Gap gap={c.savingsGap} good={isSavingsGapGood} />
                  </dd>
                </dl>
                <Meter label="% objectifs d’épargne" value={c.movingGoalPct} />
                <Meter label="% dettes remboursées" value={c.debtRepaidPct} />
                <div className="text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Budget (pour information)</p>
                  <BudgetInfo {...entry} />
                </div>
                <DeleteActualButton month={c.month} />
              </article>
            </li>
          );
        })}
      </ul>

      {/* lg and up: compact table, fully visible from a 1024 px viewport. */}
      <div className="hidden xl:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Mois</TableHead>
              <TableHead scope="col" className="text-right">
                Dettes
              </TableHead>
              <TableHead scope="col" className="text-right">
                Épargne
              </TableHead>
              <TableHead scope="col">Progression</TableHead>
              <TableHead scope="col">Verdict du mois</TableHead>
              <TableHead scope="col">Trajectoire</TableHead>
              <TableHead scope="col" className="whitespace-normal">
                Budget <span className="font-normal text-muted-foreground">(info)</span>
              </TableHead>
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const c = entry.comparison;
              const verdict = entry.actual ? verdictOf(entry.actual) : null;
              return (
                <TableRow key={c.month} className="align-top">
                  <TableHead scope="row" className="h-auto py-2 align-top font-medium">
                    <span className="block first-letter:uppercase">{formatMonthLong(c.month)}</span>
                    <PlanVersion entry={entry} className="mt-0.5 block max-w-32 whitespace-normal" />
                  </TableHead>
                  <TableCell className="align-top text-right">
                    <Comparison
                      actual={c.actualDebt}
                      planned={c.plannedDebt}
                      gap={c.debtGap}
                      good={isDebtGapGood}
                      actualWord="réel"
                      plannedWord="prévu"
                    />
                  </TableCell>
                  <TableCell className="align-top text-right">
                    <Comparison
                      actual={c.actualSavings}
                      planned={c.plannedSavings}
                      gap={c.savingsGap}
                      good={isSavingsGapGood}
                      actualWord="réelle"
                      plannedWord="prévue"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex w-32 flex-col gap-2">
                      <Meter label="% objectifs d’épargne" shortLabel="Objectifs" value={c.movingGoalPct} />
                      <Meter label="% dettes remboursées" shortLabel="Dettes remb." value={c.debtRepaidPct} />
                    </div>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <div className="flex w-56 flex-col gap-1.5">
                      <VerdictBadge verdict={verdict} />
                      {verdict ? <VerdictDetail verdict={verdict} /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">
                    <BudgetInfo {...entry} stacked />
                  </TableCell>
                  <TableCell className="w-0 align-top whitespace-normal">
                    <DeleteActualButton month={c.month} compact />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** Right-column summary (docs/design Suivi): every open month, newest first, with its status. */
export function HistoryList({
  months,
  entries,
  currentMonth,
}: {
  /** Months open to a check-in, newest first. */
  months: string[];
  entries: HistoryEntry[];
  currentMonth: string;
}) {
  const byMonth = new Map(entries.map((e) => [e.comparison.month, e]));
  // Entries outside the open months (e.g. before a re-based plan's start) are listed too.
  const all = [...new Set([...months, ...entries.map((e) => e.comparison.month)])].sort((a, b) => b.localeCompare(a));
  if (all.length === 0) return <p className="text-sm text-muted-foreground">Aucune saisie pour l’instant.</p>;
  return (
    <ol className="flex flex-col">
      {all.map((month) => {
        const entry = byMonth.get(month);
        const c = entry?.comparison;
        return (
          <li key={month} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-divider py-3 last:border-b-0">
            <span className="font-semibold first-letter:uppercase">{formatMonthLong(month)}</span>
            {c ? (
              <VerdictBadge verdict={entry?.actual ? verdictOf(entry.actual) : null} pending="non détaillé" />
            ) : month === currentMonth ? (
              <span className="text-[13px] text-muted-foreground">en cours</span>
            ) : (
              <span className="text-[13px] font-semibold text-warning">à saisir</span>
            )}
            {c ? (
              <span className="col-span-2 text-[13px] text-muted-foreground tabular-nums">
                {`Trajectoire : ${c.status ? STATUS_LABEL[c.status].toLowerCase() : "—"} · Dettes ${formatEuros(c.actualDebt)} (${
                  c.debtGap === null ? "—" : signedEuros(c.debtGap)
                }) · Épargne ${formatEuros(c.actualSavings)} (${c.savingsGap === null ? "—" : signedEuros(c.savingsGap)})`}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
