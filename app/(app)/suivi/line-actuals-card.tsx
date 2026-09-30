"use client";

import { TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BudgetLine, BudgetSettings } from "@/lib/domain/types";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
import { type BankLineTotal, lineVsBudget } from "@/lib/import/bank-rules";

/**
 * « Réel vs budget » per line of the months imported from the bank CSV (issue #63, SPEC D31). Lines
 * off budget are flagged in words and with an icon, not by colour alone.
 */
export function LineActualsCard({
  lines,
  settings,
  totals,
}: {
  lines: BudgetLine[];
  settings: Pick<BudgetSettings, "startMonth" | "expenseInflationRate" | "incomeGrowthRate">;
  totals: BankLineTotal[];
}) {
  const id = useId();
  const months = [...new Set(totals.map((t) => t.month))].sort().reverse();
  const [month, setMonth] = useState<YearMonth | undefined>(months[0]);
  const shown = month && months.includes(month) ? month : months[0];
  if (!shown) return null;
  const rows = lineVsBudget(lines, settings, shown, totals);
  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold">
          Réel vs budget par ligne
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${id}-month`} className="text-sm">
            Mois importé
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
      <Table>
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
          {rows.map((r) => (
            <TableRow key={r.line.id}>
              <TableCell className="whitespace-normal">{r.line.label}</TableCell>
              <TableCell className="text-right tabular-nums">{formatEuros(r.budget)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatEuros(r.actual)}</TableCell>
              <TableCell className={`text-right tabular-nums ${r.off ? "font-semibold text-bad" : ""}`}>
                {r.gap > 0 ? "+" : ""}
                {formatEuros(r.gap)}
                {r.off ? (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-xs">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {r.line.category === "income" ? "en dessous" : "dépassement"}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[13px] text-muted-foreground">
        Budget du mois (périodes et indexation comprises), hors mois exceptionnels. Un nouvel import du même mois remplace ces totaux.
      </p>
    </section>
  );
}
