"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoanForm } from "@/lib/domain/validation";
import { LOAN_TYPE_SUGGESTIONS } from "@/lib/labels";
import { type LoanFormState, saveLoan } from "./actions";
import { EMPTY_LOAN_FORM, type LoanRow } from "./loan-view";

const TYPE_LIST_ID = "credit-type-suggestions";

interface FieldProps {
  name: keyof LoanForm;
  label: string;
  hint?: string;
  defaultValue: string;
  error?: string;
  inputMode?: "decimal" | "text";
  type?: "text" | "month";
  list?: string;
  autoFocus?: boolean;
}

function Field({ name, label, hint, defaultValue, error, inputMode = "text", type = "text", list, autoFocus }: FieldProps) {
  const id = `credit-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        inputMode={inputMode}
        list={list}
        autoComplete="off"
        autoFocus={autoFocus}
        className="min-h-10"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Add / edit form. The parent remounts it (key) when switching loans, so the initial values
 * come from `editing`; after a failed submit the typed values come back from the action.
 */
export function LoanFormPanel({
  editing,
  onSaved,
  onCancel,
}: {
  editing: LoanRow | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<LoanFormState, FormData>(
    async (prev, formData) => {
      const next = await saveLoan(prev, formData);
      if (next.status === "success") onSaved(next.message);
      return next;
    },
    { status: "idle", values: editing?.form ?? EMPTY_LOAN_FORM },
  );
  const errors = state.status === "error" ? state.errors : {};
  const values = state.values;
  const title = editing ? `Modifier « ${editing.displayName} »` : "Ajouter un crédit";

  return (
    <form action={formAction} noValidate aria-labelledby="credit-form-title" className="flex flex-col gap-4">
      <h2 id="credit-form-title" className="text-lg font-semibold">
        {title}
      </h2>
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      {errors.form ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.form}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          name="name"
          label="Nom (facultatif)"
          hint="Vide : « Crédit n »"
          defaultValue={values.name}
          error={errors.name}
          autoFocus={editing !== null}
        />
        <Field
          name="type"
          label="Type"
          hint="Choisissez ou saisissez librement"
          defaultValue={values.type}
          error={errors.type}
          list={TYPE_LIST_ID}
        />
        <Field
          name="principal"
          label="Capital restant dû (€)"
          defaultValue={values.principal}
          error={errors.principal}
          inputMode="decimal"
        />
        <Field
          name="apr"
          label="TAEG (%)"
          hint="Ex. : 4,9"
          defaultValue={values.apr}
          error={errors.apr}
          inputMode="decimal"
        />
        <Field
          name="monthlyPayment"
          label="Mensualité (€)"
          defaultValue={values.monthlyPayment}
          error={errors.monthlyPayment}
          inputMode="decimal"
        />
        <Field
          name="contractEndMonth"
          label="Date de fin du contrat (facultatif)"
          hint="Mois de la dernière échéance (offre de prêt, relevé). Sert à vérifier vos chiffres."
          defaultValue={values.contractEndMonth}
          error={errors.contractEndMonth}
          type="month"
        />
      </div>
      <datalist id={TYPE_LIST_ID}>
        {LOAN_TYPE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-h-10 px-4">
          {pending ? "Enregistrement…" : editing ? "Enregistrer les modifications" : "Ajouter le crédit"}
        </Button>
        {editing ? (
          <Button type="button" variant="outline" onClick={onCancel} className="min-h-10 px-4">
            Annuler
          </Button>
        ) : null}
      </div>
    </form>
  );
}
