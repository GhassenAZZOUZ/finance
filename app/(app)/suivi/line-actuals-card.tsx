"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isOffBudget } from "@/lib/domain/actual-lines";
import type { MonthlyActual } from "@/lib/domain/types";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";

/**
 * « Réel vs budget » per line of the check-ins entered line by line (#72, SPEC D31): each row as
 * saved, with the budget of that month. Rows off budget are flagged in words and with an icon, not
 * by colour alone.
 */
export function LineActualsCard({ actuals }: { actuals: MonthlyActual[] }) {
  const id = useId();
  const detailed = actuals.filter((a) => a.lines.length > 0);
  const months = detailed.map((a) => a.month).sort().reverse();
  const [month, setMonth] = useState<YearMonth | undefined>(months[0]);
  const shown = month && months.includes(month) ? month : months[0];
  const actual = detailed.find((a) => a.month === shown);
  if (!shown || !actual) return null;
  // Rows neither budgeted nor spent add nothing to read.
  const rows = actual.lines.filter((l) => l.planned !== 0 || l.actual !== 0);
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold">
          Réel vs budget par ligne
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-month`} className="text-sm">
            Mois
          </Label>
          <select
            id={`${id}-month`}
            value={shown}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-md border bg-background px-2 text-sm"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLong(m)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Table label="Réel et budget par ligne">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Ligne</TableHead>
            <TableHead scope="col" className="text-right">
              Budget
            </TableHead>
            <TableHead scope="col" className="text-right">
              Réel
            </TableHead>
            <TableHead scope="col" className="text-right">
              Écart
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const gap = r.actual - r.planned;
            const off = isOffBudget(r);
            return (
              <TableRow key={`${r.kind}-${r.budgetLineId ?? r.exceptionId ?? r.direction}-${i}`}>
                <TableCell className="whitespace-normal">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuros(r.planned)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuros(r.actual)}</TableCell>
                <TableCell className={`text-right tabular-nums ${off ? "font-semibold text-bad" : ""}`}>
                  {gap > 0 ? "+" : ""}
                  {formatEuros(gap)}
                  {off ? (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-xs">
                      <TriangleAlert aria-hidden className="size-3.5" />
                      {r.direction === "income" ? "en dessous" : "dépassement"}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-[13px] text-muted-foreground">
        Budget du mois tel qu’il était à la saisie (périodes, indexation et mois exceptionnels compris).
      </p>
    </section>
  );
}
