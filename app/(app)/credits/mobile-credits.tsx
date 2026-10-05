"use client";

/**
 * Phone layout of /credits (#112; docs/design/MOBILE.md §2, mockup MobileCredits.dc.html): a dark
 * totals card, the loans repaid early as cards in priority order, the others as compact rows, and
 * the archived loans folded away. Tapping a loan edits it in a bottom sheet with the desktop form.
 */
import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import type { Loan } from "@/lib/domain/types";
import { MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import type { Cents } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeleteLoanButton } from "./delete-loan-button";
import { LoanFormPanel } from "./loan-form";
import { type LoanRow, payoffGain, sortByPriority } from "./loan-view";

/** "1,20 %": the rates keep two decimals in the compact rows (AC-03). */
const APR = new Intl.NumberFormat("fr-FR", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface MobileCreditsTotals {
  remainingDebt: Cents;
  monthlyPayments: Cents;
  weightedApr: number;
  /** Null without a plan (the engine computes it). */
  interestSaved: Cents | null;
}

export function MobileCredits({
  rows,
  archived,
  balances,
  totals,
  riskFreeRate,
  currentMonth,
}: {
  rows: LoanRow[];
  archived: readonly Loan[];
  /** Plan balance in the reference month, by loan id. */
  balances: ReadonlyMap<string, Cents>;
  totals: MobileCreditsTotals;
  /** The threshold rate, null without a plan. */
  riskFreeRate: number | null;
  currentMonth: string;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<{ message: string; seq: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const sorted = sortByPriority(rows);
  const priority = sorted.filter((r) => r.derived?.eligible && r.derived.priority !== null);
  const others = sorted.filter((r) => !priority.includes(r));
  const canAdd = rows.length < MAX_ACTIVE_LOANS;
  // A loan deleted elsewhere (other tab) closes its sheet.
  const editingRow = editing && editing !== "new" ? (rows.find((r) => r.id === editing) ?? null) : null;
  const sheetOpen = editing === "new" ? canAdd : editingRow !== null;

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  function done(message: string) {
    setEditing(null);
    setNotice((prev) => ({ message, seq: (prev?.seq ?? 0) + 1 }));
  }

  const balance = (row: LoanRow) => balances.get(row.id) ?? row.principal;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-[28px] leading-[1.15] font-medium tracking-[-0.01em]">Crédits</h1>
        <div className="flex flex-col items-end gap-0.5">
          <button
            type="button"
            disabled={!canAdd}
            aria-describedby="mobile-max-note"
            onClick={() => setEditing("new")}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-[15px] font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <Plus aria-hidden className="size-4" />
            Ajouter
          </button>
          <span id="mobile-max-note" className="text-xs text-muted-foreground">
            {rows.length} crédit{rows.length > 1 ? "s" : ""} sur {MAX_ACTIVE_LOANS}
          </span>
        </div>
      </header>

      <p
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className={notice ? "rounded-xl border border-good-border bg-good-bg px-3 py-2 text-sm text-good outline-none" : "sr-only"}
      >
        {notice?.message}
      </p>

      {riskFreeRate === null ? (
        <p className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
          <Link href="/budget" className="font-medium underline underline-offset-2">
            Renseignez le budget
          </Link>{" "}
          pour voir les priorités et les dates de fin.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
          Aucun crédit en cours. Ajoutez-en un avec « Ajouter ».
        </p>
      ) : (
        <section aria-label="Totaux" className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-[22px] bg-foreground p-5 text-background">
          <Total label="Capital restant dû" value={formatEuros(totals.remainingDebt)} wide />
          <Total label="Mensualités" value={formatEuros(totals.monthlyPayments)} />
          <Total label="TAEG moyen" value={formatPercent(totals.weightedApr)} />
          {totals.interestSaved !== null ? <Total label="Intérêts évités" value={formatEuros(totals.interestSaved)} wide /> : null}
        </section>
      )}

      {priority.length > 0 ? (
        <section aria-labelledby="mobile-priority" className="flex flex-col gap-2.5">
          <h2 id="mobile-priority" className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
            Remboursés en priorité
          </h2>
          <ol className="flex flex-col gap-2.5">
            {priority.map((row) => (
              <PriorityCard key={row.id} row={row} balance={balance(row)} onEdit={() => setEditing(row.id)} />
            ))}
          </ol>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section aria-labelledby="mobile-normal" className="flex flex-col gap-2.5">
          <h2 id="mobile-normal" className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {riskFreeRate === null ? "Vos crédits" : "Remboursement normal"}
          </h2>
          {riskFreeRate !== null && others.some((r) => r.apr <= riskFreeRate) ? (
            <p className="text-sm text-muted-foreground">
              Taux sous le seuil de {formatPercent(riskFreeRate)} : mieux vaut épargner.
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-divider rounded-2xl border bg-card">
            {others.map((row) => (
              <CompactRow key={row.id} row={row} balance={balance(row)} onEdit={() => setEditing(row.id)} />
            ))}
          </ul>
        </section>
      ) : null}

      {archived.length > 0 ? (
        <details className="rounded-2xl border bg-card p-4">
          <summary className="min-h-11 cursor-pointer content-center font-medium">Soldés ({archived.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {archived.map((loan, i) => (
              <li key={loan.id} className="flex justify-between gap-3 border-b border-divider pb-2 last:border-b-0">
                <span className="font-medium">{loan.name?.trim() || `Crédit archivé ${i + 1}`}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEuros(loan.principal)} · {APR.format(loan.apr)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Sheet
        open={sheetOpen}
        title={editingRow ? `Modifier « ${editingRow.displayName} »` : "Ajouter un crédit"}
        onClose={() => setEditing(null)}
        full
      >
        <div className="flex flex-col gap-4">
          <LoanFormPanel
            key={editingRow?.id ?? `nouveau-${rows.length}`}
            idPrefix={editingRow ? `mobile-edit-${editingRow.id}` : "credit"}
            editing={editingRow}
            titleHidden
            defaultPaidThroughMonth={currentMonth}
            onSaved={done}
            onCancel={() => setEditing(null)}
          />
          {editingRow ? (
            <div className="border-t border-divider pt-3.5">
              <DeleteLoanButton loanId={editingRow.id} loanName={editingRow.displayName} onDeleted={done} />
            </div>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}

function Total({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", wide && "col-span-2")}>
      <h3 className="text-xs font-medium tracking-[0.02em] opacity-75">{label}</h3>
      <p className={cn("font-heading leading-none font-medium tabular-nums", wide ? "text-[28px]" : "text-xl")}>{value}</p>
    </div>
  );
}

/** Loan name as a button stretched over its whole card: the card is the tap target, the name its label. */
function EditButton({ row, onEdit }: { row: LoanRow; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Modifier « ${row.displayName} »`}
      className="min-w-0 truncate text-left font-semibold after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
    >
      {row.displayName}
    </button>
  );
}

function PriorityCard({ row, balance, onEdit }: { row: LoanRow; balance: Cents; onEdit: () => void }) {
  const d = row.derived!;
  const start = row.principalAtStart?.amount ?? row.principal;
  const repaid = start > 0 ? Math.min(1, Math.max(0, 1 - balance / start)) : 1;
  const gain = payoffGain(d);
  return (
    <li className="relative flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          aria-label={`Priorité ${d.priority}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-bucket-debts text-sm font-semibold text-white"
        >
          {d.priority}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <EditButton row={row} onEdit={onEdit} />
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {APR.format(row.apr)} · {formatEuros(row.monthlyPayment)}/mois
          </span>
        </div>
        <span className="font-heading text-lg font-medium tabular-nums">{formatEuros(balance)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Remboursé : ${formatPercent(repaid, 0)}`}
        aria-valuenow={Math.round(repaid * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 overflow-hidden rounded-full bg-divider"
      >
        <div className="h-full rounded-full bg-bucket-debts" style={{ width: `${repaid * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>{d.payoffMonthWithPlan ? `Soldé en ${formatMonthLong(d.payoffMonthWithPlan)}` : "Non soldé en 25 ans"}</span>
        {gain !== null && gain > 0 ? (
          <span className="rounded-full bg-bucket-debts-tint px-2.5 py-0.5 text-xs font-semibold text-bucket-debts-ink">
            {gain} mois plus tôt
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CompactRow({ row, balance, onEdit }: { row: LoanRow; balance: Cents; onEdit: () => void }) {
  const end = row.paidOffBeforeStart ?? row.derived?.payoffMonthWithPlan ?? row.contractEndMonth;
  return (
    <li className="relative flex min-h-14 items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <EditButton row={row} onEdit={onEdit} />
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {APR.format(row.apr)}
          {end ? ` · fin ${formatMonthLong(end)}` : ""}
        </span>
      </div>
      <span className="tabular-nums">{formatEuros(balance)}</span>
    </li>
  );
}
