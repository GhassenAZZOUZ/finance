"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetException } from "@/lib/domain/types";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
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

const KIND_STYLE: Record<ExceptionKind, string> = { income: "text-green-800", expense: "text-red-700" };
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
}: {
  exceptions: BudgetException[];
  /** Plan start used for the "outside the plan" notes (live form value when valid), null without a plan. */
  startMonth: YearMonth | null;
  defaultMonth: YearMonth;
  hasSettings: boolean;
}) {
  const groups = groupExceptionsByMonth(exceptions, startMonth);
  return (
    <Card role="group" aria-labelledby="section-exceptions">
      <CardHeader>
        <CardTitle id="section-exceptions" role="heading" aria-level={2}>
          Exceptions ponctuelles
        </CardTitle>
        <p id="section-exceptions-desc" className="text-sm text-muted-foreground">
          Un revenu ou une dépense en plus pour un seul mois (prime, vacances, réparation…). Le budget des autres mois ne
          change pas.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune exception.</p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Exceptions enregistrées">
            {groups.map((group) => (
              <li key={group.month} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold first-letter:uppercase">
                  {formatMonthLong(group.month)}
                  {group.inPlan ? null : (
                    <span className="ml-2 font-normal text-amber-900">(hors de la période du plan : sans effet)</span>
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
        <AddExceptionForm defaultMonth={defaultMonth} hasSettings={hasSettings} />
      </CardContent>
    </Card>
  );
}

function ExceptionRow({ exception }: { exception: BudgetException }) {
  const Icon = KIND_ICON[exception.kind];
  const monthText = formatMonthLong(exception.month);
  const name = `« ${exception.label} » (${monthText})`;
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
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
      className="flex flex-col gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900"
    >
      <input type="hidden" name="id" value={id} />
      <p>Supprimer {name} ? Cette action est définitive.</p>
      {state.status === "error" ? (
        <p id={errorId} role="alert" className="font-medium text-red-800">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="min-h-10 bg-red-700 px-3 text-white hover:bg-red-800"
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

function AddExceptionForm({ defaultMonth, hasSettings }: { defaultMonth: YearMonth; hasSettings: boolean }) {
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
      className="flex flex-col gap-4 border-t pt-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="exception-add-title" className="text-sm font-semibold">
          Ajouter une exception
        </h3>
        <p id="exception-add-hint" className="text-sm text-muted-foreground">
          L’exception est enregistrée dès que vous cliquez sur « Ajouter », sans passer par le bouton « Enregistrer » du
          budget.
          {hasSettings ? null : " Elle comptera dans le plan une fois le budget enregistré."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="exception-month">Mois</Label>
          <Input
            id="exception-month"
            name="month"
            type="month"
            placeholder="AAAA-MM"
            defaultValue={values.month || defaultMonth}
            className="h-10"
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
            className="flex flex-wrap gap-x-4 gap-y-2"
          >
            {(["income", "expense"] as const).map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <label
                  key={k}
                  className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    defaultChecked={kind === k}
                    className="size-4"
                  />
                  <span className={`inline-flex items-center gap-1 ${KIND_STYLE[k]}`}>
                    <Icon aria-hidden className="size-4" />
                    {EXCEPTION_KIND_LABEL[k]}
                  </span>
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
            className="h-10"
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
            className="h-10 tabular-nums"
            aria-invalid={fieldError("amount") ? true : undefined}
            aria-describedby={describedBy("amount")}
          />
          <FieldError name="amount" error={fieldError("amount")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending} className="min-h-10" aria-describedby="exception-add-hint">
          <Plus aria-hidden />
          {pending ? "Ajout…" : "Ajouter"}
        </Button>
        <div aria-live="polite" className="text-sm">
          {state.status === "error" ? <p className="text-red-700">{state.message}</p> : null}
          {state.status === "success" && !pending ? <p className="text-green-800">✓ {state.message}</p> : null}
        </div>
      </div>
    </form>
  );
}

function FieldError({ name, error }: { name: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`exception-${name}-error`} className="text-sm text-red-700">
      {error}
    </p>
  );
}
