"use client";

import { ArrowDown, ArrowUp, Check, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useActionState, useState } from "react";
import { StatusBadge } from "@/components/app/status-badge";
import { GAP_TONE, STATUS_TONE } from "@/components/app/tones";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type CheckInRow, type RowSection } from "@/lib/domain/actual-lines";
import { type ActualForm, parseAmount } from "@/lib/domain/validation";
import type { ActualStatus, Cents, YearMonth } from "@/lib/engine";
import type { BudgetLine } from "@/lib/domain/types";
import type { CsvMapping } from "@/lib/import/bank-csv";
import type { BankRule } from "@/lib/import/bank-rules";
import { amountInputValue, formatEuros, formatMonthLong } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { type SaveActualState, saveActualAction } from "./actions";
import { BankImport } from "./bank-import";
import { type PlannedValues, applyLineTotals, isDebtGapGood, isSavingsGapGood, provisionalCheck } from "./logic";

export interface CheckInFormProps {
  /** Newest first. */
  months: YearMonth[];
  /** Month selected on load (e.g. from `?mois=`); defaults to the first of `months`. */
  initialMonth?: YearMonth;
  /** Pre-filled values per month (existing entry or empty fields). */
  values: Record<YearMonth, ActualForm>;
  /** Months that already have an entry. */
  existing: YearMonth[];
  /** Status of the months already entered (month buttons). */
  statuses?: Record<YearMonth, ActualStatus | null>;
  /** Month still running ("en cours"); defaults to the newest month. */
  currentMonth?: YearMonth;
  /**
   * Next month, opened before its 1st because its first income is paid (SPEC D29): its loans are
   * not entered but taken from the plan (read-only, `values` already hold them).
   */
  earlyMonth?: YearMonth | null;
  /** Budget lines and saved CSV mapping, for the bank statement import (SPEC D30); no import without lines. */
  budgetLines?: BudgetLine[];
  bankCsvMapping?: CsvMapping | null;
  bankRules?: BankRule[];
  planned: Record<YearMonth, PlannedValues | null>;
  /** Rows of each month (#72): budget lines, exceptions and « hors budget », same keys as `ActualForm.lines`. */
  rows?: Record<YearMonth, CheckInRow[]>;
  /** Active loans, same order as `ActualForm.loanBalances` and `PlannedValues.loanBalances`. */
  loans: { id: string; label: string }[];
  /** Savings goals, the primary one included (SPEC D23); same order as `ActualForm.goalBalances` and `PlannedValues.goalBalances`. */
  goals?: { id: string; label: string }[];
}

type SavingsField = "emergencySavings" | "freeSavings";

/** « Épargne voyage », « Épargne voiture »… */
export const goalFieldLabel = (name: string) => `Épargne ${name.toLocaleLowerCase("fr")}`;

const SAVINGS_FIELDS: { name: SavingsField; label: string }[] = [
  { name: "emergencySavings", label: "Fonds d’urgence" },
  { name: "freeSavings", label: "Épargne libre" },
];

/**
 * How a field's gap is judged: savings and income must not fall short, debts and expenses must not
 * exceed (±10 €, like §8.2); "info" is not judged.
 */
type GapRule = "savings" | "debt" | "income" | "expense" | "info";

const ROW_SECTIONS: { section: RowSection; title: string }[] = [
  { section: "income", title: "Revenus" },
  { section: "fixed", title: "Charges fixes" },
  { section: "variable", title: "Dépenses variables" },
];

const ROW_GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_7.5rem_10.5rem_8.5rem] sm:items-center sm:gap-3.5";

function signed(cents: Cents): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

export function CheckInForm({
  months,
  initialMonth,
  values,
  existing,
  statuses = {},
  currentMonth,
  earlyMonth = null,
  budgetLines = [],
  bankCsvMapping = null,
  bankRules = [],
  planned,
  rows = {},
  loans,
  goals = [],
}: CheckInFormProps) {
  const [state, action, pending] = useActionState<SaveActualState, FormData>(saveActualAction, { status: "idle" });
  const [form, setForm] = useState<ActualForm>(() => values[initialMonth ?? months[0] ?? ""]!);
  // Feedback of a previous submission is hidden once the user switches month.
  const [dismissed, setDismissed] = useState<SaveActualState | null>(null);
  const feedback = state === dismissed ? null : state;
  const errors = feedback?.status === "error" ? feedback.errors : {};

  const month = form.month;
  const plan = planned[month] ?? null;
  const alreadyEntered = existing.includes(month);
  const running = currentMonth ?? months[0];
  const early = month === earlyMonth;
  const check = provisionalCheck(form, plan);
  const monthRows = rows[month] ?? [];
  const lineValue = (key: string) => form.lines?.find((l) => l.key === key)?.actual ?? "";
  const rowTotal = (direction: "income" | "expense", pick: (row: CheckInRow) => number) =>
    monthRows.filter((r) => r.direction === direction).reduce((sum, r) => sum + pick(r), 0);
  const typed = (row: CheckInRow) => {
    const parsed = parseAmount(lineValue(row.key));
    return parsed.ok && parsed.value !== null ? parsed.value : 0;
  };

  // Months to enter first (oldest first), then the ones already entered (newest first).
  const ordered = [...months.filter((m) => !existing.includes(m)).reverse(), ...months.filter((m) => existing.includes(m))];

  function selectMonth(next: YearMonth) {
    setForm(values[next] ?? { ...form, month: next });
    setDismissed(state);
  }

  const setGoal = (goalId: string, value: string) =>
    setForm((f) => ({
      ...f,
      goalBalances: (f.goalBalances ?? []).map((b) => (b.goalId === goalId ? { ...b, balance: value } : b)),
    }));
  const setField = (name: keyof Omit<ActualForm, "loanBalances" | "goalBalances" | "month">, value: string) =>
    setForm((f) => ({ ...f, [name]: value }));
  const setLine = (key: string, value: string) =>
    setForm((f) => ({ ...f, lines: (f.lines ?? []).map((l) => (l.key === key ? { ...l, actual: value } : l)) }));
  /** « Tout comme prévu »: the budget into the rows still empty. */
  const fillPlanned = (section: CheckInRow[]) =>
    setForm((f) => ({
      ...f,
      lines: (f.lines ?? []).map((l) => {
        const row = section.find((r) => r.key === l.key);
        return row && l.actual.trim() === "" ? { ...l, actual: amountInputValue(row.planned) } : l;
      }),
    }));
  const setLoan = (loanId: string, value: string) =>
    setForm((f) => ({ ...f, loanBalances: f.loanBalances.map((b) => (b.loanId === loanId ? { ...b, balance: value } : b)) }));

  const knownFields = new Set([
    "month",
    ...monthRows.map((r) => `line.${r.key}`),
    ...SAVINGS_FIELDS.map((f) => f.name),
    ...loans.map((l) => `loan.${l.id}`),
    ...goals.map((g) => `goal.${g.id}`),
  ]);
  const orphanErrors = Object.entries(errors).filter(([key]) => !knownFields.has(key));

  return (
    <form action={action} noValidate className="flex flex-col gap-5.5">
      <input type="hidden" name="month" value={month} />

      <div className="flex flex-col gap-3">
        <h2 id="suivi-month-title" className="text-[17px] font-semibold">
          Mois à saisir
        </h2>
        <div role="group" aria-labelledby="suivi-month-title" className="flex gap-2.5 overflow-x-auto pb-1">
          {ordered.map((m) => {
            const entered = existing.includes(m);
            const status = statuses[m] ?? null;
            const selected = m === month;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={selected}
                onClick={() => selectMonth(m)}
                className={cn(
                  "flex min-h-11 min-w-40 shrink-0 flex-col items-start gap-0.5 rounded-xl border bg-card px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  entered && status ? STATUS_TONE[status].tile : null,
                  selected && "border-foreground ring-1 ring-foreground",
                )}
              >
                <span className="font-semibold first-letter:uppercase">{formatMonthLong(m)}</span>
                <span className={cn("text-[13px]", entered && status ? STATUS_TONE[status].text : "text-muted-foreground")}>
                  {entered
                    ? `saisi${status ? ` · ${STATUS_LABEL[status].toLowerCase()}` : ""}`
                    : m === earlyMonth
                      ? "ouvert en avance"
                      : m === running
                        ? "en cours"
                        : "à saisir"}
                </span>
              </button>
            );
          })}
        </div>
        {alreadyEntered ? (
          <p id="suivi-month-existing" className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            Déjà saisi — la modification remplacera la saisie
          </p>
        ) : null}
        <FieldError id="suivi-month-error" message={errors.month} />
      </div>

      <p className="text-sm text-muted-foreground">Les champs marqués d’un * sont obligatoires. Montants en euros, ex. 1 234,56.</p>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-[15px] font-semibold">Revenus et dépenses du mois</legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Ce que vous avez réellement reçu et dépensé, ligne par ligne, hors mensualités de crédit et hors épargne. « Comme prévu »
          reprend le budget du mois.
        </p>
        {budgetLines.length > 0 ? (
          <BankImport
            key={month}
            month={month}
            lines={budgetLines}
            savedMapping={bankCsvMapping}
            rules={bankRules}
            onApply={(totals) => setForm((f) => ({ ...f, lines: applyLineTotals(f.lines ?? [], monthRows, totals) }))}
          />
        ) : null}
        {ROW_SECTIONS.map(({ section, title }) => {
          const sectionRows = monthRows.filter((r) => r.section === section);
          if (sectionRows.length === 0) return null;
          return (
            <div key={section} role="group" aria-labelledby={`suivi-rows-${section}`} className="flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`suivi-rows-${section}`} className="text-sm font-semibold">
                  {title}
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-9"
                  aria-label={`Tout comme prévu : ${title}`}
                  onClick={() => fillPlanned(sectionRows)}
                >
                  Tout comme prévu
                </Button>
              </div>
              <ColumnHeads />
              {sectionRows.map((row) => (
                <AmountRow
                  key={row.key}
                  id={`suivi-line-${row.key}`}
                  name={`line.${row.key}`}
                  label={row.label}
                  required
                  value={lineValue(row.key)}
                  onChange={(v) => setLine(row.key, v)}
                  planned={row.planned}
                  rule={row.direction}
                  error={errors[`line.${row.key}`]}
                  extra={
                    <button
                      type="button"
                      className="min-h-6 text-[13px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      aria-label={`Comme prévu : ${row.label}`}
                      onClick={() => setLine(row.key, amountInputValue(row.planned))}
                    >
                      Comme prévu
                    </button>
                  }
                />
              ))}
            </div>
          );
        })}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
          <span>
            Total revenus : <strong>{formatEuros(rowTotal("income", typed))}</strong>{" "}
            <span className="text-muted-foreground">(prévu {formatEuros(rowTotal("income", (r) => r.planned))})</span>
          </span>
          <span>
            Total dépenses : <strong>{formatEuros(rowTotal("expense", typed))}</strong>{" "}
            <span className="text-muted-foreground">(prévu {formatEuros(rowTotal("expense", (r) => r.planned))})</span>
          </span>
        </p>
      </fieldset>

      <fieldset className="flex flex-col">
        <legend className="mb-1 text-[15px] font-semibold">Épargne en fin de mois</legend>
        <ColumnHeads />
        {goals.map((goal, j) => (
          <AmountRow
            key={goal.id}
            id={`suivi-goal-${goal.id}`}
            name={`goal.${goal.id}`}
            label={goalFieldLabel(goal.label)}
            required
            value={form.goalBalances?.find((b) => b.goalId === goal.id)?.balance ?? ""}
            onChange={(v) => setGoal(goal.id, v)}
            planned={plan?.goalBalances[j] ?? null}
            rule="savings"
            error={errors[`goal.${goal.id}`]}
          />
        ))}
        {SAVINGS_FIELDS.map((field) => (
          <AmountRow
            key={field.name}
            id={`suivi-${field.name}`}
            name={field.name}
            label={field.label}
            required
            value={form[field.name]}
            onChange={(v) => setField(field.name, v)}
            planned={plan ? plan[field.name] : null}
            rule="savings"
            error={errors[field.name]}
          />
        ))}
      </fieldset>

      {loans.length > 0 ? (
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-[15px] font-semibold">
            Capital restant dû <span className="font-normal text-muted-foreground">· relevés de crédit</span>
          </legend>
          {early ? (
            <p className="mb-2 flex items-start gap-2 text-sm text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              Mois ouvert en avance : l’échéance de {formatMonthLong(month)} est considérée comme payée d’ici la fin du mois. Les soldes
              sont repris du plan, rien à saisir.
            </p>
          ) : null}
          <ColumnHeads />
          {early
            ? loans.map((loan, j) => (
                <div key={loan.id} className={cn("flex items-center justify-between gap-3 border-t border-divider py-2.5 text-sm", ROW_GRID)}>
                  <span className="font-medium">{loan.label}</span>
                  <span className="text-right tabular-nums text-muted-foreground sm:col-span-2">
                    {plan ? formatEuros(plan.loanBalances[j] ?? 0) : "—"}
                    <span className="sr-only"> : solde après l’échéance de {formatMonthLong(month)}, repris du plan</span>
                  </span>
                  <span aria-hidden className="hidden sm:block" />
                </div>
              ))
            : null}
          {early ? null : loans.map((loan, j) => (
            <AmountRow
              key={loan.id}
              id={`suivi-loan-${loan.id}`}
              name={`loan.${loan.id}`}
              label={loan.label}
              required
              value={form.loanBalances.find((b) => b.loanId === loan.id)?.balance ?? ""}
              onChange={(v) => setLoan(loan.id, v)}
              planned={plan?.loanBalances[j] ?? null}
              rule="debt"
              error={errors[`loan.${loan.id}`]}
            />
          ))}
        </fieldset>
      ) : null}

      <div id="suivi-form-feedback" aria-live="polite" className="empty:hidden">
        {feedback?.status === "saved" ? (
          <div role="status" className="flex flex-col gap-2 rounded-xl border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 aria-hidden className="size-4 shrink-0" />
              Mois de {formatMonthLong(feedback.month)} enregistré.
            </p>
            <p className="flex flex-wrap items-center gap-2">
              Statut : {feedback.result ? <StatusBadge status={feedback.result} /> : "hors de l’horizon du plan"}
            </p>
          </div>
        ) : null}
        {feedback?.status === "error" ? (
          <div role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-4 py-3 text-sm text-bad">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              {feedback.message}
            </p>
            {orphanErrors.length > 0 ? (
              <p className="mt-1">Vos crédits ont changé depuis l’ouverture de la page : rechargez-la puis recommencez.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Stays visible above the mobile tab bar (and at the bottom of the screen on desktop) while scrolling. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3 rounded-xl bg-secondary px-4.5 py-4 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)] sm:flex-row sm:items-center sm:justify-between md:bottom-4">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-muted-foreground">Statut provisoire</span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            {check.status ? <StatusBadge status={check.status} /> : <span className="font-semibold">—</span>}
            <span className="text-muted-foreground tabular-nums">
              {[
                check.debtGap !== null ? `dettes ${signed(check.debtGap)}` : null,
                check.savingsGap !== null ? `épargne ${signed(check.savingsGap)}` : null,
                check.missing > 0 ? `${check.missing} solde${check.missing > 1 ? "s" : ""} à saisir` : null,
                !plan ? "hors de l’horizon du plan" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </div>
        <Button type="submit" disabled={pending} className="min-h-11 px-4.5 text-[15px]">
          {pending ? "Enregistrement…" : `Enregistrer ${formatMonthLong(month)}`}
        </Button>
      </div>
    </form>
  );
}

/** "Prévu / Réel / Écart" above each group (desktop only; each row repeats them for screen readers). */
function ColumnHeads() {
  return (
    <div aria-hidden className={cn("hidden pb-1.5 text-xs font-medium text-muted-foreground", ROW_GRID)}>
      <span />
      <span className="text-right">Prévu</span>
      <span className="text-right">Réel</span>
      <span className="text-right">Écart</span>
    </div>
  );
}

function AmountRow({
  id,
  name,
  label,
  required = false,
  value,
  onChange,
  planned,
  rule,
  error,
  extra,
}: {
  id: string;
  name: string;
  label: string;
  /** Under the label, e.g. « Comme prévu ». */
  extra?: ReactNode;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  planned: number | null;
  rule: GapRule;
  error: string | undefined;
}) {
  const hintId = `${id}-hint`;
  const gapId = `${id}-gap`;
  const errorId = `${id}-error`;
  const parsed = parseAmount(value);
  const gap = planned !== null && parsed.ok && parsed.value !== null ? parsed.value - planned : null;
  const describedBy = [planned !== null ? hintId : "", gap !== null ? gapId : "", error ? errorId : ""].join(" ").trim() || undefined;
  return (
    <div className="flex flex-col gap-1.5 border-b border-divider py-2.5 last:border-b-0">
      <div className={ROW_GRID}>
        <div className="flex flex-col items-start">
          <label htmlFor={id} className="text-[15px] font-medium">
            {label}
            {required ? (
              <span className="text-muted-foreground" aria-hidden>
                *
              </span>
            ) : null}
          </label>
          {extra}
        </div>
        <p id={hintId} className={cn("text-sm text-muted-foreground tabular-nums sm:text-right", planned === null && "hidden")}>
          <span className="sm:sr-only">Prévu : </span>
          {planned !== null ? formatEuros(planned) : null}
        </p>
        <div className="relative mt-1.5 sm:mt-0">
          <Input
            id={id}
            name={name}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            required={required}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="h-11 pr-8 text-right text-base tabular-nums"
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            €
          </span>
        </div>
        <GapValue id={gapId} gap={gap} rule={rule} />
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** Live gap: colour + arrow/check + words, never colour alone. */
function GapValue({ id, gap, rule }: { id: string; gap: Cents | null; rule: GapRule }) {
  if (gap === null) {
    return (
      <span aria-hidden className="mt-1 hidden text-right text-sm text-muted-foreground sm:mt-0 sm:block">
        —
      </span>
    );
  }
  // Income falls short like savings; expenses exceed like debts (same ±10 € tolerance).
  const good =
    rule === "savings" || rule === "income" ? isSavingsGapGood(gap) : rule === "debt" || rule === "expense" ? isDebtGapGood(gap) : null;
  const Icon = gap === 0 || good ? Check : gap > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      id={id}
      className={cn(
        "mt-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums sm:mt-0 sm:justify-end",
        good === null ? "font-normal text-muted-foreground" : good ? GAP_TONE.good : GAP_TONE.bad,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
      <span className="sm:sr-only">Écart : </span>
      {signed(gap)}
      {good !== null ? <span className="sr-only">{good ? " (dans la tolérance)" : " (hors tolérance)"}</span> : null}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-bad">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      {message}
    </p>
  );
}
