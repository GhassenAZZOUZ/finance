"use client";

import { type RefObject, useActionState, useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetException } from "@/lib/domain/types";
import { type YearMonth, addMonths, compareMonths } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type DeleteExceptionState,
  type ExceptionFormState,
  addExceptionAction,
  deleteExceptionAction,
} from "./actions";
import {
  EMPTY_EXCEPTION_FORM,
  EXCEPTION_KIND_LABEL,
  EXCEPTION_SIGN,
  type ExceptionKind,
  groupExceptionsByMonth,
} from "./exceptions-view";

const KIND_STYLE: Record<ExceptionKind, string> = { income: "text-good", expense: "text-bad" };
const KIND_ICON = { income: Plus, expense: Minus } as const;

const INITIAL_STATE: ExceptionFormState = { status: "idle", values: EMPTY_EXCEPTION_FORM };

/**
 * One-off exceptions (SPEC D14). Rendered outside the main budget <form> (forms cannot nest):
 * adding or deleting saves immediately, independently of the "Enregistrer" button.
 */
export function ExceptionsCard({
  exceptions,
  startMonth,
  defaultMonth,
  hasSettings,
  currentMonth,
}: {
  exceptions: BudgetException[];
  /** Plan start used for the "outside the plan" notes (live form value when valid), null without a plan. */
  startMonth: YearMonth | null;
  defaultMonth: YearMonth;
  hasSettings: boolean;
  /** Highlighted in the 12-month strip; the strip is hidden without it. */
  currentMonth?: YearMonth;
}) {
  const groups = groupExceptionsByMonth(exceptions, startMonth);
  const monthInput = useRef<HTMLInputElement>(null);
  return (
    <section
      role="group"
      aria-labelledby="section-exceptions"
      className="flex flex-col gap-4 rounded-2xl border bg-card px-4 py-5 md:px-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="section-exceptions" className="text-[17px] font-semibold">
          Exceptions ponctuelles
        </h2>
        <p id="section-exceptions-desc" className="text-[13px] leading-snug text-muted-foreground">
          Un revenu ou une dépense en plus pour un seul mois : prime, vacances, réparation. Le budget des autres mois ne
          change pas.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {currentMonth ? (
          <MonthStrip
            months={stripMonths(currentMonth, startMonth)}
            currentMonth={currentMonth}
            exceptions={exceptions}
            onPick={(month) => {
              if (!monthInput.current) return;
              monthInput.current.value = month;
              monthInput.current.focus();
            }}
          />
        ) : null}
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune exception.</p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Exceptions enregistrées">
            {groups.map((group) => (
              <li key={group.month} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold first-letter:uppercase">
                  {formatMonthLong(group.month)}
                  {group.inPlan ? null : (
                    <span className="ml-2 font-normal text-warning">(hors de la période du plan : sans effet)</span>
                  )}
                </h3>
                <ul className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <ExceptionRow key={item.id} exception={item} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <AddExceptionForm defaultMonth={defaultMonth} hasSettings={hasSettings} monthInput={monthInput} />
      </div>
    </section>
  );
}

/** 12 months from two months ago (not before the plan start), for the strip. */
function stripMonths(currentMonth: YearMonth, startMonth: YearMonth | null): YearMonth[] {
  let first = addMonths(currentMonth, -2);
  if (startMonth && compareMonths(startMonth, first) > 0 && compareMonths(startMonth, currentMonth) <= 0) first = startMonth;
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

/** The next months at a glance: current month in ink, months with an exception marked. A click picks the month. */
function MonthStrip({
  months,
  currentMonth,
  exceptions,
  onPick,
}: {
  months: YearMonth[];
  currentMonth: YearMonth;
  exceptions: readonly BudgetException[];
  onPick: (month: YearMonth) => void;
}) {
  const counts = new Map<YearMonth, number>();
  for (const e of exceptions) counts.set(e.month, (counts.get(e.month) ?? 0) + 1);
  const shortName = (m: YearMonth) => formatMonthShort(m).replace(/ \d{4}$/, "");
  return (
    <ol aria-label="Choisir un mois pour l’exception" className="grid grid-cols-6 gap-1 text-xs tabular-nums sm:grid-cols-12">
      {months.map((m) => {
        const count = counts.get(m) ?? 0;
        const current = m === currentMonth;
        return (
          <li key={m}>
            <button
              type="button"
              onClick={() => onPick(m)}
              aria-current={current ? "date" : undefined}
              aria-label={`${formatMonthLong(m)}${count > 0 ? ` : ${count} exception${count > 1 ? "s" : ""}` : ""}`}
              className={cn(
                "relative flex min-h-10 w-full flex-col items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                current ? "bg-primary font-semibold text-primary-foreground" : "bg-secondary text-muted-foreground hover:bg-accent",
              )}
            >
              {shortName(m)}
              {count > 0 ? (
                <span aria-hidden className={cn("absolute bottom-1 size-1.5 rounded-full", current ? "bg-bucket-moving" : "bg-bucket-debts")} />
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ExceptionRow({ exception }: { exception: BudgetException }) {
  const Icon = KIND_ICON[exception.kind];
  const monthText = formatMonthLong(exception.month);
  const name = `« ${exception.label} » (${monthText})`;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-divider p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className={`inline-flex items-center gap-1 font-medium ${KIND_STYLE[exception.kind]}`}>
          <Icon aria-hidden className="size-4" />
          {EXCEPTION_KIND_LABEL[exception.kind]}
        </span>
        <span className="break-words">{exception.label}</span>
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <span className={`text-sm font-semibold tabular-nums ${KIND_STYLE[exception.kind]}`}>
          {EXCEPTION_SIGN[exception.kind]}
          {" "}
          {formatEuros(exception.amount)}
        </span>
        <DeleteExceptionButton id={exception.id} name={name} />
      </div>
    </li>
  );
}

/** "Supprimer" with an inline confirmation step (no window.confirm). */
function DeleteExceptionButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteExceptionState, FormData>(deleteExceptionAction, {
    status: "idle",
  });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Move focus into the confirmation, and back to the trigger when it closes.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className="min-h-10 self-start sm:self-end"
        onClick={() => setConfirming(true)}
        aria-label={`Supprimer ${name}`}
      >
        <Trash2 aria-hidden />
        Supprimer
      </Button>
    );
  }

  const errorId = `exception-${id}-erreur`;
  return (
    <form
      action={formAction}
      role="group"
      aria-label={`Confirmer la suppression de ${name}`}
      className="flex flex-col gap-2 rounded-md border border-bad-border bg-bad-bg p-2 text-sm text-bad"
    >
      <input type="hidden" name="id" value={id} />
      <p>Supprimer {name} ? Cette action est définitive.</p>
      {state.status === "error" ? (
        <p id={errorId} role="alert" className="font-medium text-bad">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="min-h-10 bg-bad px-3 text-white hover:bg-bad/90"
          aria-describedby={state.status === "error" ? errorId : undefined}
        >
          {pending ? "Suppression…" : "Confirmer la suppression"}
        </Button>
        <Button
          ref={cancelRef}
          type="button"
          variant="outline"
          className="min-h-10 px-3"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}

function AddExceptionForm({
  defaultMonth,
  hasSettings,
  monthInput,
}: {
  defaultMonth: YearMonth;
  hasSettings: boolean;
  monthInput: RefObject<HTMLInputElement | null>;
}) {
  const [state, formAction, pending] = useActionState(addExceptionAction, INITIAL_STATE);
  const errors = state.status === "error" ? state.errors : {};
  const values = state.values;
  const kind = values.kind === "income" ? "income" : "expense";
  const fieldError = (name: string) => errors[name];
  const describedBy = (name: string, hint?: boolean) =>
    [hint ? `exception-${name}-hint` : null, errors[name] ? `exception-${name}-error` : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form
      action={formAction}
      noValidate
      aria-labelledby="exception-add-title"
      className="flex flex-col gap-3 border-t border-divider pt-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="exception-add-title" className="text-sm font-semibold">
          Ajouter une exception
        </h3>
        <p id="exception-add-hint" className="text-[13px] text-muted-foreground">
          L’exception est enregistrée dès que vous cliquez sur « Ajouter », sans passer par le bouton « Enregistrer » du
          budget.
          {hasSettings ? null : " Elle comptera dans le plan une fois le budget enregistré."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-[9.5rem_12.5rem_minmax(0,1fr)_8.5rem_auto] 2xl:items-start">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exception-month">Mois</Label>
          <Input
            ref={monthInput}
            id="exception-month"
            name="month"
            type="month"
            placeholder="AAAA-MM"
            defaultValue={values.month || defaultMonth}
            className="h-10.5"
            aria-invalid={fieldError("month") ? true : undefined}
            aria-describedby={describedBy("month")}
          />
          <FieldError name="month" error={fieldError("month")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="exception-kind-label" className="text-sm leading-none font-medium">
            Type
          </span>
          <div
            role="radiogroup"
            aria-labelledby="exception-kind-label"
            aria-invalid={fieldError("kind") ? true : undefined}
            aria-describedby={describedBy("kind")}
            className="grid h-10.5 grid-cols-2 overflow-hidden rounded-[10px] border border-input bg-card text-sm"
          >
            {(["income", "expense"] as const).map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <label
                  key={k}
                  className="flex cursor-pointer items-center justify-center gap-1 px-2 whitespace-nowrap has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring"
                >
                  <input type="radio" name="kind" value={k} defaultChecked={kind === k} className="sr-only" />
                  <Icon aria-hidden className="size-4" />
                  <span aria-hidden>{k === "income" ? "Revenu" : "Dépense"}</span>
                  <span className="sr-only">{EXCEPTION_KIND_LABEL[k]}</span>
                </label>
              );
            })}
          </div>
          <FieldError name="kind" error={fieldError("kind")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exception-label">Libellé</Label>
          <Input
            id="exception-label"
            name="label"
            defaultValue={values.label}
            maxLength={100}
            autoComplete="off"
            placeholder="Prime, vacances, réparation…"
            className="h-10.5"
            aria-invalid={fieldError("label") ? true : undefined}
            aria-describedby={describedBy("label")}
          />
          <FieldError name="label" error={fieldError("label")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exception-amount">
            Montant <span className="text-muted-foreground">(€)</span>
          </Label>
          <Input
            id="exception-amount"
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={values.amount}
            className="h-10.5 text-right tabular-nums"
            aria-invalid={fieldError("amount") ? true : undefined}
            aria-describedby={describedBy("amount")}
          />
          <FieldError name="amount" error={fieldError("amount")} />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={pending}
          className="min-h-10.5 self-start sm:col-span-2 sm:justify-self-start 2xl:col-span-1 2xl:mt-5.5"
          aria-describedby="exception-add-hint"
        >
          <Plus aria-hidden />
          {pending ? "Ajout…" : "Ajouter"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div aria-live="polite" className="text-sm">
          {state.status === "error" ? <p className="text-bad">{state.message}</p> : null}
          {state.status === "success" && !pending ? <p className="text-good">✓ {state.message}</p> : null}
        </div>
      </div>
    </form>
  );
}

function FieldError({ name, error }: { name: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`exception-${name}-error`} className="text-sm text-bad">
      {error}
    </p>
  );
}
