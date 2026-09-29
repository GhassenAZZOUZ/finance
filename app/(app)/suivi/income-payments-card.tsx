"use client";

import { Banknote } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getRepository, notifyDataChanged } from "@/lib/data/client-store";
import { expectedPayDate, incomeLinesFor, paidOnBounds, paymentFor } from "@/lib/domain/payday";
import type { BudgetLine, IncomePayment } from "@/lib/domain/types";
import { parsePaidOn } from "@/lib/domain/validation";
import type { YearMonth } from "@/lib/engine";
import { errorMessage, reportError } from "@/lib/errors";
import { formatDate, formatMonthLong } from "@/lib/format";

/**
 * « Revenus de <mois> » (issue #60, SPEC D29): for each income line of a month, its expected date
 * (usual payday) and the actual date when it differs. Months: the next one first, then the open ones.
 */
export function IncomePaymentsCard({
  months,
  lines,
  payments,
  today,
  footer,
}: {
  /** Months offered, the first one shown by default (next month, then the open months). */
  months: YearMonth[];
  lines: BudgetLine[];
  payments: IncomePayment[];
  /** YYYY-MM-DD, Europe/Paris. */
  today: string;
  /** Extra line under the rows (e.g. when the month opens, #61). */
  footer?: (month: YearMonth) => React.ReactNode;
}) {
  const selectId = useId();
  const [month, setMonth] = useState(months[0]);
  if (!month) return null;
  const incomes = incomeLinesFor(lines, month);
  if (incomes.length === 0) return null;
  return (
    <section aria-labelledby={`${selectId}-title`} className="flex flex-col gap-3.5 rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${selectId}-title`} className="flex items-center gap-2 text-[17px] font-semibold">
          <Banknote aria-hidden className="size-5 shrink-0" />
          Revenus {ofMonth(month)}
        </h2>
        {months.length > 1 ? (
          <>
            <Label htmlFor={selectId} className="sr-only">
              Mois des revenus
            </Label>
            <select
              id={selectId}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLong(m)}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <ul className="flex flex-col gap-3">
        {incomes.map((line) => (
          <IncomeRow key={`${month}-${line.id}`} month={month} line={line} payment={paymentFor(payments, month, line.id)} today={today} />
        ))}
      </ul>
      {footer ? footer(month) : null}
    </section>
  );
}

/** « de septembre 2026 », « d’octobre 2026 » (elision before a vowel). */
export function ofMonth(month: YearMonth): string {
  const name = formatMonthLong(month);
  return /^[aeiouâéè]/i.test(name) ? `d’${name}` : `de ${name}`;
}

function IncomeRow({ month, line, payment, today }: { month: YearMonth; line: BudgetLine; payment?: IncomePayment; today: string }) {
  const id = useId();
  const [value, setValue] = useState(payment?.paidOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expected = expectedPayDate(line, month);
  const { first, last } = paidOnBounds(month);

  async function save(paidOn: string | null) {
    setError(null);
    setNotice(null);
    if (paidOn !== null) {
      const parsed = parsePaidOn(paidOn, month, today);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
    }
    setBusy(true);
    try {
      await getRepository().setIncomePayment(month, line.id, paidOn);
      notifyDataChanged();
      if (paidOn === null) setValue("");
      setNotice(paidOn === null ? "Date retirée : le jour habituel s’applique." : "Date enregistrée.");
    } catch (saveError) {
      reportError(saveError, "income.payment");
      setError(errorMessage(saveError, "La date n’a pas été enregistrée. Réessayez dans un instant."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-divider p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-medium">{line.label}</p>
        <p className="text-[13px] text-muted-foreground tabular-nums">
          {payment ? `Versé le ${formatDate(payment.paidOn)}` : `${expected <= today ? "Versé" : "Attendu"} le ${formatDate(expected)}`}
        </p>
      </div>
      <form
        noValidate
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={id} className="text-[13px]">
            Versé à une autre date
          </Label>
          <Input
            id={id}
            type="date"
            min={first}
            max={last < today ? last : today}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-auto"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
        </div>
        <Button type="submit" variant="outline" className="min-h-10" disabled={busy}>
          Enregistrer
        </Button>
        {payment ? (
          <Button type="button" variant="ghost" className="min-h-10" disabled={busy} onClick={() => void save(null)}>
            Retirer
          </Button>
        ) : null}
      </form>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-good">
          {notice}
        </p>
      ) : null}
    </li>
  );
}
