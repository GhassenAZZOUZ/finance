"use client";

import { Check, Minus, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  if (row.principalAtStart) {
    return (
      <span className="block text-xs font-normal text-muted-foreground">
        ≈ {formatEuros(row.principalAtStart.amount)} au début du plan ({formatMonthShort(row.principalAtStart.month)})
      </span>
    );
  }
  if (row.principalReadAfterStart) {
    return (
      <span className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800">
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
  onEdit: () => void;
  onDeleted: (message: string) => void;
}

function RowActions({ row, editing, onEdit, onDeleted }: RowActionsProps) {
  return (
    <div className="flex flex-wrap items-start gap-2">
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

  function actionsFor(row: LoanRow) {
    return (
      <RowActions
        row={row}
        editing={row.id === editingId}
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
          {/* Large screens: full table (scrolls horizontally if needed). */}
          <div className="hidden rounded-lg border lg:block">
            <Table>
              <caption className="sr-only">Crédits en cours et totaux</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Nom</TableHead>
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col" className="text-right">
                    Capital restant dû
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    TAEG
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Mensualité
                  </TableHead>
                  <TableHead scope="col">Fin du contrat</TableHead>
                  {hasPlan ? (
                    <>
                      <TableHead scope="col">Remb. anticipé rentable</TableHead>
                      <TableHead scope="col" className="text-center">
                        Priorité
                      </TableHead>
                      <TableHead scope="col">Conseil</TableHead>
                      <TableHead scope="col">Fin avec plan</TableHead>
                      <TableHead scope="col">Fin sans plan</TableHead>
                      <TableHead scope="col" className="text-right">
                        Intérêts avec plan
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        Intérêts sans plan
                      </TableHead>
                    </>
                  ) : null}
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-state={row.id === editingId ? "selected" : undefined}>
                    <TableHead scope="row" className="min-w-40 whitespace-normal align-top font-medium">
                      {row.displayName}
                      {row.paymentBelowInterest ? <BelowInterestWarning /> : null}
                      {row.endCheck ? <ContractEndWarning check={row.endCheck} /> : null}
                    </TableHead>
                    <TableCell className="align-top">{row.type ?? "—"}</TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      {formatEuros(row.principal)}
                      <PrincipalNote row={row} />
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">{formatPercent(row.apr)}</TableCell>
                    <TableCell className="text-right align-top tabular-nums">{formatEuros(row.monthlyPayment)}</TableCell>
                    <TableCell className="align-top">{contractEndText(row)}</TableCell>
                    {row.derived ? (
                      <>
                        <TableCell className="align-top">
                          <EligibleBadge eligible={row.derived.eligible} />
                        </TableCell>
                        <TableCell className="text-center align-top tabular-nums">
                          {row.derived.priority ?? "—"}
                        </TableCell>
                        <TableCell className="min-w-44 whitespace-normal align-top">
                          <Advice advice={row.derived.advice} />
                        </TableCell>
                        <TableCell className="align-top">{payoffText(row.derived.payoffMonthWithPlan)}</TableCell>
                        <TableCell className="align-top">{payoffText(row.derived.payoffMonthWithoutPlan)}</TableCell>
                        <TableCell className="text-right align-top tabular-nums">
                          {formatEuros(row.derived.interestWithPlan)}
                        </TableCell>
                        <TableCell className="text-right align-top tabular-nums">
                          {formatEuros(row.derived.interestWithoutPlan)}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell className="align-top">{actionsFor(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableHead scope="row" colSpan={2}>
                    Total
                  </TableHead>
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
                  <TableCell colSpan={hasPlan ? 9 : 2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* Small screens: one card per loan. */}
          <ul className="flex flex-col gap-3 lg:hidden" aria-label="Crédits en cours">
            {rows.map((row) => (
              <li key={row.id}>
                <Card className={row.id === editingId ? "ring-2 ring-ring" : undefined}>
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
                          <CardItem label="Fin avec plan" value={payoffText(row.derived.payoffMonthWithPlan)} />
                          <CardItem label="Fin sans plan" value={payoffText(row.derived.payoffMonthWithoutPlan)} />
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
          <Card className="lg:hidden">
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
