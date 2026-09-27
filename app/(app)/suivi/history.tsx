import { CheckCircle2, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { GAP_TONE } from "@/components/app/tones";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Cents } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatPercent } from "@/lib/format";
import { DeleteActualButton } from "./delete-actual-button";
import { type HistoryEntry, isDebtGapGood, isSavingsGapGood } from "./logic";

function signedEuros(cents: Cents): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

const optionalEuros = (cents: Cents | null) => (cents === null ? "—" : formatEuros(cents));

/** Gap with colour + icon + screen-reader text, so colour is never the only cue. */
function Gap({ gap, good }: { gap: Cents | null; good: (gap: Cents) => boolean }) {
  if (gap === null) return <span className="text-muted-foreground">—</span>;
  const ok = good(gap);
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${ok ? GAP_TONE.good : GAP_TONE.bad}`}>
      <Icon aria-hidden className="size-4 shrink-0" />
      {signedEuros(gap)}
      <span className="sr-only">{ok ? "(dans la tolérance)" : "(hors tolérance)"}</span>
    </span>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{formatPercent(value, 0)}</span>
      </div>
      <Progress value={percent} aria-label={label} className="h-2" />
    </div>
  );
}

/** Actual income/expenses vs budget: information only, not part of the status (SPEC §8.1). */
function BudgetInfo({ actual, comparison }: HistoryEntry) {
  const items = [
    { label: "Revenus", value: actual?.income ?? null, gap: comparison.incomeGap },
    { label: "Dépenses", value: actual?.expenses ?? null, gap: comparison.expensesGap },
  ].filter((i) => i.value !== null);
  if (items.length === 0) return <span className="text-muted-foreground">Non renseigné</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((i) => (
        <li key={i.label}>
          {i.label} : <span className="tabular-nums">{optionalEuros(i.value)}</span>
          {i.gap !== null ? <span className="text-muted-foreground tabular-nums"> (écart {signedEuros(i.gap)})</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function History({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune saisie pour l’instant. Enregistrez votre premier mois ci-dessus.</p>;
  }
  return (
    <>
      {/* Mobile: one card per month. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {entries.map((entry) => {
          const c = entry.comparison;
          return (
            <li key={c.month} className="rounded-lg border bg-card p-4">
              <article aria-labelledby={`suivi-card-${c.month}`} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 id={`suivi-card-${c.month}`} className="font-semibold first-letter:uppercase">
                    {formatMonthLong(c.month)}
                  </h3>
                  <StatusBadge status={c.status} />
                </div>
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
                <Meter label="% objectif déménagement" value={c.movingGoalPct} />
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

      {/* Desktop: table. */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Mois</TableHead>
              <TableHead scope="col" className="text-right">Dettes réelles / prévues</TableHead>
              <TableHead scope="col" className="text-right">Écart dettes</TableHead>
              <TableHead scope="col" className="text-right">Épargne réelle / prévue</TableHead>
              <TableHead scope="col" className="text-right">Écart épargne</TableHead>
              <TableHead scope="col" className="min-w-40">Progression</TableHead>
              <TableHead scope="col">Statut</TableHead>
              <TableHead scope="col">Budget (info)</TableHead>
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const c = entry.comparison;
              return (
                <TableRow key={c.month} className="align-top">
                  <TableHead scope="row" className="font-medium first-letter:uppercase">
                    {formatMonthLong(c.month)}
                  </TableHead>
                  <TableCell className="text-right tabular-nums">
                    {formatEuros(c.actualDebt)}
                    <span className="block text-xs text-muted-foreground">prévu {optionalEuros(c.plannedDebt)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Gap gap={c.debtGap} good={isDebtGapGood} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEuros(c.actualSavings)}
                    <span className="block text-xs text-muted-foreground">prévu {optionalEuros(c.plannedSavings)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Gap gap={c.savingsGap} good={isSavingsGapGood} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-2">
                      <Meter label="% objectif déménagement" value={c.movingGoalPct} />
                      <Meter label="% dettes remboursées" value={c.debtRepaidPct} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal">
                    <BudgetInfo {...entry} />
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteActualButton month={c.month} />
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
