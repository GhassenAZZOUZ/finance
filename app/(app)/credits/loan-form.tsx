"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LoanForm } from "@/lib/domain/validation";
import { LOAN_TYPE_SUGGESTIONS } from "@/lib/labels";
import { type LoanFormState, saveLoan } from "./actions";
import { EMPTY_LOAN_FORM, type LoanRow } from "./loan-view";


interface FieldProps {
  idPrefix: string;
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

function Field({ idPrefix, name, label, hint, defaultValue, error, inputMode = "text", type = "text", list, autoFocus }: FieldProps) {
  const id = `${idPrefix}-${name}`;
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
        className={`h-10.5 ${inputMode === "decimal" ? "text-right tabular-nums" : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
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
  defaultPaidThroughMonth,
  onSaved,
  onCancel,
  idPrefix = "credit",
}: {
  editing: LoanRow | null;
  /** Prefix of the field ids: the add form and an inline edit form can be on the page together. */
  idPrefix?: string;
  /** Pre-filled "last payment already made" month for a new loan (the current month). */
  defaultPaidThroughMonth: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<LoanFormState, FormData>(
    async (prev, formData) => {
      const next = await saveLoan(prev, formData);
      if (next.status === "success") onSaved(next.message);
      return next;
    },
    {
      status: "idle",
      values: editing?.form ?? { ...EMPTY_LOAN_FORM, principalPaidThroughMonth: defaultPaidThroughMonth },
    },
  );
  const errors = state.status === "error" ? state.errors : {};
  const values = state.values;
  // An existing debt keeps its kind; a new one is a loan unless « Découvert bancaire » is chosen.
  const [kind, setKind] = useState<"loan" | "overdraft">(editing?.kind ?? (values.kind === "overdraft" ? "overdraft" : "loan"));
  const kindName = useId();
  const overdraft = kind === "overdraft";
  const title = editing ? `Modifier « ${editing.displayName} »` : "Ajouter un crédit";

  return (
    <form action={formAction} noValidate aria-labelledby={`${idPrefix}-form-title`} className="flex flex-col gap-4">
      <h2 id={`${idPrefix}-form-title`} className={editing ? "sr-only" : "text-[17px] font-semibold"}>
        {title}
      </h2>
      {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
      {/* The state is the source of truth: React resets the form (radios included) after an action. */}
      <input type="hidden" name="kind" value={kind} />
      {editing ? null : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium">Type de dette</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {(
              [
                ["loan", "Crédit (mensualité fixe)"],
                ["overdraft", "Découvert bancaire"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
                <input
                  type="radio"
                  name={`${kindName}-kind`}
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                  className="size-4 accent-primary"
                  aria-describedby={value === "overdraft" ? `${kindName}-hint` : undefined}
                />
                {label}
              </label>
            ))}
          </div>
          <p id={`${kindName}-hint`} className="text-[13px] leading-snug text-muted-foreground">
            Découvert : pas de mensualité, réutilisable ; les mois en budget négatif puisent dedans jusqu’à l’autorisation.
          </p>
        </fieldset>
      )}
      {errors.form ? (
        <p role="alert" className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          {errors.form}
        </p>
      ) : null}
      {/* Distinct keys: the two grids must not share (and keep the values of) their inputs. */}
      {overdraft ? (
        <div key="overdraft" className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Nom (facultatif)"
            hint="Ex. : Découvert compte courant"
            defaultValue={values.name}
            error={errors.name}
            autoFocus={editing !== null}
          />
          <Field
            idPrefix={idPrefix}
            name="creditLimit"
            label="Autorisation de découvert (€)"
            hint="Montant maximum autorisé par la banque."
            defaultValue={values.creditLimit ?? ""}
            error={errors.creditLimit}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="principal"
            label="Solde utilisé (€)"
            hint="Montant à découvert aujourd’hui, 0 si le compte est positif."
            defaultValue={values.principal}
            error={errors.principal}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="apr"
            label="Taux des agios (%)"
            hint="TAEG du découvert, ex. : 16"
            defaultValue={values.apr}
            error={errors.apr}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="monthlyPayment"
            label="Remboursement mensuel fixe (€, facultatif)"
            hint="Vide : aucun, le découvert est remboursé par le plan."
            defaultValue={values.monthlyPayment}
            error={errors.monthlyPayment}
            inputMode="decimal"
          />
        </div>
      ) : (
        <div key="loan" className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
          <Field
            idPrefix={idPrefix}
            name="name"
            label="Nom (facultatif)"
            hint="Vide : « Crédit n »"
            defaultValue={values.name}
            error={errors.name}
            autoFocus={editing !== null}
          />
          <Field
            idPrefix={idPrefix}
            name="type"
            label="Type"
            hint="Choisissez ou saisissez librement"
            defaultValue={values.type}
            error={errors.type}
            list={`${idPrefix}-type-suggestions`}
          />
          <Field
            idPrefix={idPrefix}
            name="principal"
            label="Capital restant dû (€)"
            defaultValue={values.principal}
            error={errors.principal}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="principalPaidThroughMonth"
            label="Dernière mensualité déjà payée"
            hint="Mois de la dernière échéance prélevée quand vous avez relevé ce capital. L’app déduit les mensualités suivantes jusqu’au début du plan. Vide : capital au début du plan."
            defaultValue={values.principalPaidThroughMonth}
            error={errors.principalPaidThroughMonth}
            type="month"
          />
          <Field
            idPrefix={idPrefix}
            name="apr"
            label="TAEG (%)"
            hint="Ex. : 4,9"
            defaultValue={values.apr}
            error={errors.apr}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="monthlyPayment"
            label="Mensualité (€)"
            defaultValue={values.monthlyPayment}
            error={errors.monthlyPayment}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="contractEndMonth"
            label="Date de fin du contrat (facultatif)"
            hint="Mois de la dernière échéance (offre de prêt, relevé). Sert à vérifier vos chiffres."
            defaultValue={values.contractEndMonth}
            error={errors.contractEndMonth}
            type="month"
          />
          <Field
            idPrefix={idPrefix}
            name="penaltyPct"
            label="IRA (% du capital remboursé, facultatif)"
            hint="Indemnités de remboursement anticipé, voir l’offre de prêt. Crédit immobilier : 3 % au plus. Vide : aucune."
            defaultValue={values.penaltyPct ?? ""}
            error={errors.penaltyPct}
            inputMode="decimal"
          />
          <Field
            idPrefix={idPrefix}
            name="penaltyCapMonths"
            label="Plafond des IRA (mois d’intérêts, facultatif)"
            hint="Crédit immobilier : 6 mois d’intérêts au plus. Vide : pas de plafond."
            defaultValue={values.penaltyCapMonths ?? ""}
            error={errors.penaltyCapMonths}
            inputMode="decimal"
          />
        </div>
      )}
      <datalist id={`${idPrefix}-type-suggestions`}>
        {LOAN_TYPE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap justify-end gap-2.5 border-t border-divider pt-3.5">
        {editing ? (
          <Button type="button" variant="outline" onClick={onCancel} className="min-h-11 px-4.5">
            Annuler
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} className="min-h-11 px-4.5">
          {pending ? "Enregistrement…" : editing ? "Enregistrer les modifications" : "Ajouter le crédit"}
        </Button>
      </div>
    </form>
  );
}
