"use client";

import { Check, Minus, TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MAX_ACTIVE_LOANS } from "@/lib/domain/types";
import type { LoanAdvice, YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { ADVICE_LABEL } from "@/lib/labels";
import { DeleteLoanButton } from "./delete-loan-button";
import { LoanFormPanel } from "./loan-form";
import type { ContractEndCheck, LoanRow, LoanTotals } from "./loan-view";

const BELOW_INTEREST_TEXT = "La mensualité ne couvre pas les intérêts : le capital augmente.";

/** Entered principal, plus its projection at the plan start when it differs (SPEC D5c). */
function PrincipalNote({ row }: { row: LoanRow }) {
  if (row.paidOffBeforeStart) {
    return (
      <span className="mt-1 flex items-start justify-end gap-1 whitespace-normal text-xs font-medium text-green-800">
        <Check aria-hidden className="mt-px size-3.5 shrink-0" />
        Soldé en {formatMonthShort(row.paidOffBeforeStart)}, avant le début du plan. Vous pouvez le supprimer.
      </span>
    );
  }
  if (row.principalAtStart) {
    return (
      <span className="block whitespace-normal text-xs font-normal text-muted-foreground">
        ≈ {formatEuros(row.principalAtStart.amount)} au début du plan ({formatMonthShort(row.principalAtStart.month)})
      </span>
    );
  }
  if (row.principalReadAfterStart) {
    return (
      <span className="mt-1 flex items-start gap-1 whitespace-normal text-xs font-medium text-amber-800">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        Capital relevé après le début du plan ({formatMonthShort(row.principalReadAfterStart)}) : utilisé tel quel.
      </span>
    );
  }
  return null;
}

function contractEndText(row: LoanRow): string {
  return row.contractEndMonth ? formatMonthShort(row.contractEndMonth) : "—";
}

/** Contract end differs from the simulated end (SPEC D5b): the capital, APR or payment is probably off. */
function ContractEndWarning({ check }: { check: ContractEndCheck }) {
  if (check.consistent) return null;
  const simulated = check.simulatedEndMonth
    ? `se termine en ${formatMonthLong(check.simulatedEndMonth)}`
    : "ne se termine pas avant 25 ans";
  const gap =
    check.gapMonths === null ? "" : ` (${check.gapMonths > 0 ? "+" : "−"}${Math.abs(check.gapMonths)} mois)`;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800">
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        Fin du contrat : {formatMonthLong(check.contractEndMonth)}, mais avec cette mensualité le crédit {simulated}
        {gap}. Vérifiez le capital restant dû, le TAEG ou la mensualité.
      </span>
    </p>
  );
}

/** End month shown for "Fin avec / sans plan". */
function endText(row: LoanRow, month: YearMonth | null): string {
  if (row.paidOffBeforeStart) return `Soldé (${formatMonthShort(row.paidOffBeforeStart)})`;
  return payoffText(month);
}

function payoffText(month: YearMonth | null): string {
  return month ? formatMonthShort(month) : "Au-delà de 25 ans";
}

function EligibleBadge({ eligible }: { eligible: boolean }) {
  return eligible ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
      <Check aria-hidden className="size-3" />
      Oui
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Minus aria-hidden className="size-3" />
      Non
    </span>
  );
}

function Advice({ advice }: { advice: LoanAdvice }) {
  if (advice === "highRate") {
    return (
      <span className="inline-flex items-start gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">
        <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        {ADVICE_LABEL[advice]}
      </span>
    );
  }
  return <span className={advice === "worthIt" ? "text-green-800" : "text-muted-foreground"}>{ADVICE_LABEL[advice]}</span>;
}

/** Early-repayment verdict with the priority rank underneath (desktop table). */
function EligibleWithPriority({ eligible, priority }: { eligible: boolean; priority: number | null }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <EligibleBadge eligible={eligible} />
      {priority !== null ? <span className="whitespace-nowrap tabular-nums">Priorité {priority}</span> : null}
    </div>
  );
}

/** Several labelled values in one cell (e.g. "avec plan : … / sans plan : …"). */
function LabelledValues({ items, align = "start" }: { items: { label: string; value: ReactNode }[]; align?: "start" | "end" }) {
  return (
    <dl
      className={`grid grid-cols-[auto_auto] items-baseline gap-x-2 gap-y-0.5 ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="whitespace-nowrap text-xs text-muted-foreground">{item.label}</dt>
          <dd className={`whitespace-nowrap tabular-nums ${align === "end" ? "text-right" : ""}`}>{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function BelowInterestWarning() {
  return (
    <p className="mt-1 flex items-start gap-1 text-xs font-medium text-red-700">
      <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
      {BELOW_INTEREST_TEXT}
    </p>
  );
}

interface RowActionsProps {
  row: LoanRow;
  editing: boolean;
  /** Buttons one above the other (narrow table column). */
  stacked?: boolean;
  onEdit: () => void;
  onDeleted: (message: string) => void;
}

function RowActions({ row, editing, stacked, onEdit, onDeleted }: RowActionsProps) {
  return (
    <div className={stacked ? "flex flex-col items-stretch gap-2" : "flex flex-wrap items-start gap-2"}>
      <Button
        type="button"
        variant="outline"
        className="min-h-10 px-3"
        onClick={onEdit}
        aria-pressed={editing}
        aria-label={`Modifier « ${row.displayName} »`}
      >
        Modifier
      </Button>
      <DeleteLoanButton loanId={row.id} loanName={row.displayName} onDeleted={onDeleted} />
    </div>
  );
}

/** Active loans (table on large screens, cards below), totals, and the add / edit form. */
export function LoansManager({
  rows,
  totals,
  hasPlan,
  currentMonth,
}: {
  rows: LoanRow[];
  totals: LoanTotals;
  hasPlan: boolean;
  currentMonth: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; focus: boolean; seq: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  // A loan deleted elsewhere (other tab) simply drops out of edit mode.
  const editing = rows.find((r) => r.id === editingId) ?? null;
  const canAdd = rows.length < MAX_ACTIVE_LOANS;

  useEffect(() => {
    if (notice?.focus) noticeRef.current?.focus();
  }, [notice]);

  function announce(message: string, focus: boolean) {
    setNotice((prev) => ({ message, focus, seq: (prev?.seq ?? 0) + 1 }));
  }

  function actionsFor(row: LoanRow, stacked = false) {
    return (
      <RowActions
        row={row}
        editing={row.id === editingId}
        stacked={stacked}
        onEdit={() => setEditingId(row.id)}
        onDeleted={(message) => {
          if (row.id === editingId) setEditingId(null);
          announce(message, true);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className={
          notice
            ? "rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            : "sr-only"
        }
      >
        {notice?.message}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Aucun crédit en cours. Ajoutez-en un avec le formulaire ci-dessous (facultatif si vous n’en avez pas).
        </p>
      ) : (
        <>
          {/* From 1280px: full table, compacted so it fits without horizontal scrolling. */}
          <div className="hidden rounded-lg border xl:block">
            <Table>
              <caption className="sr-only">Crédits en cours et totaux</caption>
              <TableHeader>
                <TableRow className="[&>th]:whitespace-normal [&>th]:align-bottom [&>th]:py-2">
                  <TableHead scope="col">Nom</TableHead>
                  <TableHead scope="col" className="text-right">
                    Capital restant dû
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    TAEG
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Mensualité
                  </TableHead>
                  {hasPlan ? (
                    <>
                      <TableHead scope="col" className="min-w-28">
                        Remb. anticipé rentable (priorité)
                      </TableHead>
                      <TableHead scope="col">Conseil</TableHead>
                      <TableHead scope="col">Fin du crédit</TableHead>
                      <TableHead scope="col" className="text-right">
                        Intérêts
                      </TableHead>
                    </>
                  ) : (
                    <TableHead scope="col">Fin du contrat</TableHead>
                  )}
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-state={row.id === editingId ? "selected" : undefined}>
                    <TableHead scope="row" className="h-auto min-w-36 whitespace-normal py-2 align-top font-medium">
                      {row.displayName}
                      {row.type ? (
                        <span className="block text-xs font-normal text-muted-foreground">{row.type}</span>
                      ) : null}
                      {row.paymentBelowInterest ? <BelowInterestWarning /> : null}
                      {row.endCheck ? <ContractEndWarning check={row.endCheck} /> : null}
                    </TableHead>
                    <TableCell className="min-w-28 text-right align-top tabular-nums">
                      {formatEuros(row.principal)}
                      <PrincipalNote row={row} />
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">{formatPercent(row.apr)}</TableCell>
                    <TableCell className="text-right align-top tabular-nums">{formatEuros(row.monthlyPayment)}</TableCell>
                    {hasPlan ? (
                      row.derived ? (
                        <>
                          <TableCell className="align-top">
                            <EligibleWithPriority eligible={row.derived.eligible} priority={row.derived.priority} />
                          </TableCell>
                          <TableCell className="min-w-32 whitespace-normal align-top">
                            <Advice advice={row.derived.advice} />
                          </TableCell>
                          <TableCell className="align-top">
                            <LabelledValues
                              items={[
                                ...(row.contractEndMonth
                                  ? [{ label: "contrat", value: contractEndText(row) }]
                                  : []),
                                { label: "avec plan", value: endText(row, row.derived.payoffMonthWithPlan) },
                                { label: "sans plan", value: endText(row, row.derived.payoffMonthWithoutPlan) },
                              ]}
                            />
                          </TableCell>
                          <TableCell className="align-top">
                            <LabelledValues
                              align="end"
                              items={[
                                { label: "avec plan", value: formatEuros(row.derived.interestWithPlan) },
                                { label: "sans plan", value: formatEuros(row.derived.interestWithoutPlan) },
                              ]}
                            />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={4} className="align-top text-muted-foreground">
                          —
                        </TableCell>
                      )
                    ) : (
                      <TableCell className="align-top">{contractEndText(row)}</TableCell>
                    )}
                    <TableCell className="align-top">{actionsFor(row, true)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead scope="row">Total</TableHead>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatEuros(totals.totalPrincipal)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    <span className="sr-only">TAEG moyen pondéré : </span>
                    {formatPercent(totals.weightedApr)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatEuros(totals.monthlyPayments)}
                  </TableCell>
                  <TableCell colSpan={hasPlan ? 5 : 2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* Below 1280px: one card per loan (two columns from 768px), never a horizontal scrollbar. */}
          <ul className="flex flex-col gap-3 md:grid md:grid-cols-2 xl:hidden" aria-label="Crédits en cours">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className={row.id === editingId ? "h-full ring-2 ring-ring" : "h-full"}>
                  <CardContent className="flex flex-col gap-3">
                    <div>
                      <h3 className="font-semibold">{row.displayName}</h3>
                      {row.type ? <p className="text-sm text-muted-foreground">{row.type}</p> : null}
                      {row.paymentBelowInterest ? <BelowInterestWarning /> : null}
                      {row.endCheck ? <ContractEndWarning check={row.endCheck} /> : null}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <CardItem
                        label="Capital restant dû"
                        value={
                          <>
                            {formatEuros(row.principal)}
                            <PrincipalNote row={row} />
                          </>
                        }
                      />
                      <CardItem label="TAEG" value={formatPercent(row.apr)} />
                      <CardItem label="Mensualité" value={formatEuros(row.monthlyPayment)} />
                      <CardItem label="Fin du contrat" value={contractEndText(row)} />
                      {row.derived ? (
                        <>
                          <CardItem
                            label="Remb. anticipé rentable"
                            value={<EligibleBadge eligible={row.derived.eligible} />}
                          />
                          <CardItem label="Priorité" value={row.derived.priority ?? "—"} />
                          <CardItem label="Fin avec plan" value={endText(row, row.derived.payoffMonthWithPlan)} />
                          <CardItem label="Fin sans plan" value={endText(row, row.derived.payoffMonthWithoutPlan)} />
                          <CardItem label="Intérêts avec plan" value={formatEuros(row.derived.interestWithPlan)} />
                          <CardItem label="Intérêts sans plan" value={formatEuros(row.derived.interestWithoutPlan)} />
                          <CardItem label="Conseil" value={<Advice advice={row.derived.advice} />} wide />
                        </>
                      ) : null}
                    </dl>
                    {actionsFor(row)}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Card className="xl:hidden">
            <CardContent>
              <h3 className="mb-2 font-semibold">Total</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <CardItem label="Capital restant dû" value={formatEuros(totals.totalPrincipal)} />
                <CardItem label="TAEG moyen pondéré" value={formatPercent(totals.weightedApr)} />
                <CardItem label="Mensualités" value={formatEuros(totals.monthlyPayments)} />
              </dl>
            </CardContent>
          </Card>
        </>
      )}

      <section id="formulaire-credit" className="rounded-lg border p-4" aria-label="Formulaire crédit">
        {editing || canAdd ? (
          <LoanFormPanel
            key={editing?.id ?? "nouveau"}
            editing={editing}
            defaultPaidThroughMonth={currentMonth}
            onSaved={(message) => {
              announce(message, editing !== null);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
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

function CardItem({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
