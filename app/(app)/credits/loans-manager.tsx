"use client";

import { Check, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import { type Cents, type LoanAdvice, type YearMonth, addMonths } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { ADVICE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { DeleteLoanButton } from "./delete-loan-button";
import { LoanFormPanel } from "./loan-form";
import {
  type ContractEndCheck,
  type LoanRow,
  type TimelineScale,
  payoffGain,
  sortByPriority,
  timelinePosition,
} from "./loan-view";

const BELOW_INTEREST_TEXT = "La mensualité ne couvre pas les intérêts : le capital augmente.";

/** Row grid from lg: priority | name | balance | APR | payment | timeline | edit. */
const ROW_GRID =
  "lg:grid lg:grid-cols-[2.5rem_minmax(9rem,1fr)_7rem_4.5rem_6rem_minmax(12rem,25rem)_2.75rem] lg:items-center lg:gap-3";

const ADVICE_TAG: Record<LoanAdvice, string> = {
  highRate: "bg-bucket-debts-tint text-bucket-debts-ink",
  worthIt: "bg-secondary text-sidebar-foreground",
  keep: "bg-good-bg text-good",
};

/** Entered principal, plus its projection at the plan start when it differs (SPEC D5c). */
function PrincipalNote({ row }: { row: LoanRow }) {
  if (row.paidOffBeforeStart) {
    return (
      <span className="mt-1 flex items-start gap-1 text-xs font-medium text-good">
        <Check aria-hidden className="mt-px size-3.5 shrink-0" />
        Soldé en {formatMonthShort(row.paidOffBeforeStart)}, avant le début du plan. Vous pouvez le supprimer.
      </span>
    );
  }
  if (row.principalAtStart) {
    return (
      <span className="block text-xs text-muted-foreground">
        Saisi : {formatEuros(row.principal)} · ≈ {formatEuros(row.principalAtStart.amount)} au début du plan (
        {formatMonthShort(row.principalAtStart.month)})
      </span>
    );
  }
  if (row.principalReadAfterStart) {
    return (
      <span className="mt-1 flex items-start gap-1 text-xs font-medium text-warning">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        Capital relevé après le début du plan ({formatMonthShort(row.principalReadAfterStart)}) : utilisé tel quel.
      </span>
    );
  }
  return null;
}

/** IRA rule of the loan and what the plan pays in penalties (SPEC D22). */
function PenaltyNote({ row }: { row: LoanRow }) {
  if (!row.penaltyPct) return null;
  const cap = row.penaltyCapMonths !== null ? `, plafond ${row.penaltyCapMonths} mois d’intérêts` : "";
  const paid = row.derived?.penaltiesPaid ?? 0;
  return (
    <span className="block text-xs text-muted-foreground">
      IRA : {formatPercent(row.penaltyPct)} du capital remboursé{cap}
      {row.derived ? (paid > 0 ? ` · ${formatEuros(paid)} payés par le plan` : " · aucune payée par le plan") : ""}
    </span>
  );
}

/** Contract end differs from the simulated end (SPEC D5b): the capital, APR or payment is probably off. */
function ContractEndWarning({ check }: { check: ContractEndCheck }) {
  if (check.consistent) return null;
  const simulated = check.simulatedEndMonth
    ? `se termine en ${formatMonthLong(check.simulatedEndMonth)}`
    : "ne se termine pas avant 25 ans";
  const gap = check.gapMonths === null ? "" : ` (${check.gapMonths > 0 ? "+" : "−"}${Math.abs(check.gapMonths)} mois)`;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs font-medium text-warning">
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        Fin du contrat : {formatMonthLong(check.contractEndMonth)}, mais avec cette mensualité le crédit {simulated}
        {gap}. Vérifiez le capital restant dû, le TAEG ou la mensualité.
      </span>
    </p>
  );
}

function PriorityBadge({ priority }: { priority: number | null }) {
  if (priority === null) {
    return (
      <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-placeholder text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">Pas de remboursement anticipé</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums",
        priority === 1 ? "bg-bucket-debts text-white" : "bg-bucket-debts-tint text-bucket-debts-ink",
      )}
    >
      <span className="sr-only">Priorité </span>
      {priority}
    </span>
  );
}

/** Payoff with the plan (●) vs without (○) on a shared time axis ("dumbbell"). */
function PayoffTimeline({ row, scale }: { row: LoanRow; scale: TimelineScale | null }) {
  const d = row.derived;
  if (row.paidOffBeforeStart) {
    return <span className="text-xs text-muted-foreground">Soldé ({formatMonthShort(row.paidOffBeforeStart)})</span>;
  }
  if (!d || !scale) {
    return (
      <span className="text-xs text-muted-foreground">
        {row.contractEndMonth ? `Fin du contrat : ${formatMonthShort(row.contractEndMonth)}` : "Fin : renseignez le budget"}
      </span>
    );
  }
  const withPlan = d.payoffMonthWithPlan;
  const without = d.payoffMonthWithoutPlan;
  if (!withPlan) return <span className="text-xs text-bad">Non soldé en 25 ans</span>;
  const gain = payoffGain(d);
  const pos = (m: YearMonth) => `${timelinePosition(scale, m) * 100}%`;
  const gained = gain !== null && gain > 0;
  const aprZero = row.apr === 0;
  const label = gained
    ? `Soldé en ${formatMonthLong(withPlan)} avec le plan, ${formatMonthLong(without!)} sans : ${gain} mois plus tôt`
    : `Soldé en ${formatMonthLong(withPlan)}${without ? ", avec ou sans le plan" : ""}`;
  const text = gained
    ? `${formatMonthShort(withPlan)} · −${gain} mois`
    : `${formatMonthShort(withPlan)} · ${d.eligible ? "avec ou sans plan" : aprZero ? "dernière échéance" : "sous le taux seuil"}`;
  return (
    <div role="img" aria-label={label} className="relative h-9 w-full">
      <div className="absolute inset-x-0 top-[21px] h-0.5 bg-divider" />
      {gained ? (
        <div
          className="absolute top-5 h-1 bg-bucket-debts-tint"
          style={{ left: pos(withPlan), width: `calc(${pos(without!)} - ${pos(withPlan)})` }}
        />
      ) : null}
      <div
        className={cn("absolute top-4 size-3 -translate-x-1/2 rounded-full", gained ? "bg-bucket-debts" : "bg-bucket-payments")}
        style={{ left: pos(withPlan) }}
      />
      {gained ? (
        <div
          className="absolute top-4 size-3 -translate-x-1/2 rounded-full border-2 border-bucket-payments bg-card"
          style={{ left: pos(without!) }}
        />
      ) : null}
      <span
        aria-hidden
        className={cn(
          "absolute top-0 text-xs whitespace-nowrap tabular-nums",
          gained ? "font-semibold text-bucket-debts-ink" : "text-muted-foreground",
          timelinePosition(scale, withPlan) > 0.6 ? "-translate-x-full" : "",
        )}
        style={{ left: pos(withPlan) }}
      >
        {text}
      </span>
    </div>
  );
}

/** Years above the timelines column (decorative). */
function TimelineAxis({ scale }: { scale: TimelineScale }) {
  const ticks: { month: YearMonth; left: number }[] = [];
  for (let i = 0; i < scale.months; i++) {
    const month = addMonths(scale.start, i);
    if (i === 0 || month.endsWith("-01")) ticks.push({ month, left: i / scale.months });
  }
  return (
    <div className="relative h-4">
      {ticks.map((t) => (
        <span key={t.month} className="absolute" style={{ left: `${t.left * 100}%` }}>
          {t.month.slice(0, 4)}
        </span>
      ))}
    </div>
  );
}

/** Active loans in repayment order, inline edit under a row, and the add form. */
export function LoansManager({
  rows,
  hasPlan,
  currentMonth,
  balances,
  scale = null,
  referenceMonth = null,
}: {
  rows: LoanRow[];
  hasPlan: boolean;
  currentMonth: string;
  /** Plan balance of each loan in the reference month (shown instead of the entered principal). */
  balances?: ReadonlyMap<string, Cents>;
  scale?: TimelineScale | null;
  referenceMonth?: YearMonth | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; focus: boolean; seq: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());

  // A loan deleted elsewhere (other tab) simply drops out of edit mode.
  const editing = rows.find((r) => r.id === editingId) ?? null;
  const canAdd = rows.length < MAX_ACTIVE_LOANS;
  const sorted = sortByPriority(rows);

  useEffect(() => {
    if (notice?.focus) noticeRef.current?.focus();
  }, [notice]);

  function announce(message: string, focus: boolean) {
    setNotice((prev) => ({ message, focus, seq: (prev?.seq ?? 0) + 1 }));
  }

  function closeEdit(id: string) {
    setEditingId(null);
    editButtons.current.get(id)?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <p
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className={
          notice
            ? "rounded-xl border border-good-border bg-good-bg px-3 py-2 text-sm text-good focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            : "sr-only"
        }
      >
        {notice?.message}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
          Aucun crédit en cours. Ajoutez-en un avec le formulaire ci-dessous (facultatif si vous n’en avez pas).
        </p>
      ) : (
        <section aria-labelledby="list-title" className="flex flex-col overflow-hidden rounded-2xl border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 pt-5 pb-2 md:px-5">
            <h2 id="list-title" className="text-[17px] font-semibold">
              {hasPlan ? "Dans l’ordre de remboursement" : "Crédits en cours"}
            </h2>
            {hasPlan ? (
              <div className="flex gap-4.5 text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-full bg-bucket-debts" />
                  Fin avec le plan
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-full border-2 border-bucket-payments" />
                  Fin sans le plan
                </span>
              </div>
            ) : null}
          </div>
          <div aria-hidden className={cn("hidden border-b border-divider px-5 py-2 text-xs font-medium text-muted-foreground", ROW_GRID)}>
            <span>Prio.</span>
            <span>Crédit</span>
            <span className="text-right">Restant dû</span>
            <span className="text-right">TAEG</span>
            <span className="text-right">Mensualité</span>
            {scale ? <TimelineAxis scale={scale} /> : <span>Fin</span>}
            <span />
          </div>
          <ul aria-label="Crédits en cours">
            {sorted.map((row) => {
              const isEditing = row.id === editingId;
              const balance = balances?.get(row.id);
              return (
                <li key={row.id} className={cn("border-b border-divider last:border-b-0", isEditing && "bg-row-highlight")}>
                  <article aria-labelledby={`loan-${row.id}-name`} className={cn("grid grid-cols-[2.5rem_minmax(0,1fr)_2.75rem] gap-x-3 gap-y-2 px-4 py-3.5 md:px-5", ROW_GRID)}>
                    <PriorityBadge priority={row.derived?.priority ?? null} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <h3 id={`loan-${row.id}-name`} className="font-semibold">
                        {row.displayName}
                        {row.type ? <span className="font-normal text-muted-foreground"> · {row.type}</span> : null}
                      </h3>
                      {row.derived ? (
                        <span>
                          <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", ADVICE_TAG[row.derived.advice])}>
                            {ADVICE_LABEL[row.derived.advice]}
                          </span>
                        </span>
                      ) : null}
                      {row.paymentBelowInterest ? (
                        <p className="flex items-start gap-1 text-xs font-medium text-bad">
                          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
                          {BELOW_INTEREST_TEXT}
                        </p>
                      ) : null}
                      {row.endCheck ? <ContractEndWarning check={row.endCheck} /> : null}
                      <PrincipalNote row={row} />
                      <PenaltyNote row={row} />
                    </div>
                    <Button
                      ref={(el) => {
                        editButtons.current.set(row.id, el);
                      }}
                      type="button"
                      variant={isEditing ? "default" : "ghost"}
                      size="icon"
                      className="size-11 justify-self-end text-muted-foreground aria-expanded:bg-primary aria-expanded:text-primary-foreground lg:order-last"
                      onClick={() => (isEditing ? closeEdit(row.id) : setEditingId(row.id))}
                      aria-expanded={isEditing}
                      aria-controls={isEditing ? `loan-${row.id}-edit` : undefined}
                      aria-label={`Modifier « ${row.displayName} »`}
                    >
                      <Pencil aria-hidden className="size-4.5" />
                    </Button>
                    <dl className="col-span-3 grid grid-cols-3 gap-3 text-sm lg:contents">
                      <div className="lg:text-right">
                        <dt className="text-xs text-muted-foreground lg:sr-only">
                          Restant dû{referenceMonth && balance !== undefined ? ` (${formatMonthShort(referenceMonth)})` : ""}
                        </dt>
                        <dd className="tabular-nums">{formatEuros(balance ?? row.principal)}</dd>
                      </div>
                      <div className="lg:text-right">
                        <dt className="text-xs text-muted-foreground lg:sr-only">TAEG</dt>
                        <dd className="font-semibold tabular-nums">{formatPercent(row.apr)}</dd>
                      </div>
                      <div className="lg:text-right">
                        <dt className="text-xs text-muted-foreground lg:sr-only">Mensualité</dt>
                        <dd className="tabular-nums">{formatEuros(row.monthlyPayment)}</dd>
                      </div>
                    </dl>
                    <div className="col-span-3 lg:col-span-1">
                      <PayoffTimeline row={row} scale={scale} />
                    </div>
                  </article>
                  {isEditing && editing ? (
                    <div id={`loan-${row.id}-edit`} className="mx-4 mb-5 flex flex-col gap-4 rounded-[14px] border bg-card p-4 md:p-5 lg:ml-[4.75rem]">
                      <LoanFormPanel
                        key={editing.id}
                        idPrefix={`credit-edit-${editing.id}`}
                        editing={editing}
                        defaultPaidThroughMonth={currentMonth}
                        onSaved={(message) => {
                          announce(message, true);
                          setEditingId(null);
                        }}
                        onCancel={() => closeEdit(row.id)}
                      />
                      <div className="border-t border-divider pt-3.5">
                        <DeleteLoanButton
                          loanId={row.id}
                          loanName={row.displayName}
                          onDeleted={(message) => {
                            setEditingId(null);
                            announce(message, true);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="formulaire-credit" className="rounded-2xl border bg-card p-4 md:p-6" aria-label="Formulaire crédit">
        {canAdd ? (
          <LoanFormPanel
            key={`nouveau-${rows.length}`}
            editing={null}
            defaultPaidThroughMonth={currentMonth}
            onSaved={(message) => announce(message, false)}
            onCancel={() => undefined}
          />
        ) : (
          <p className="text-sm">
            <strong>{MAX_ACTIVE_LOANS} crédits maximum.</strong> Supprimez ou soldez un crédit pour en ajouter un autre.
          </p>
        )}
      </section>
    </div>
  );
}
