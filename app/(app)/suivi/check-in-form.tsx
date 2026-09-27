"use client";

import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActualForm } from "@/lib/domain/validation";
import type { YearMonth } from "@/lib/engine";
import { formatEuros, formatMonthLong } from "@/lib/format";
import { type SaveActualState, saveActualAction } from "./actions";
import type { PlannedValues } from "./logic";

export interface CheckInFormProps {
  /** Newest first; the first one (current month) is preselected. */
  months: YearMonth[];
  /** Pre-filled values per month (existing entry or empty fields). */
  values: Record<YearMonth, ActualForm>;
  /** Months that already have an entry. */
  existing: YearMonth[];
  planned: Record<YearMonth, PlannedValues | null>;
  /** Active loans, same order as `ActualForm.loanBalances` and `PlannedValues.loanBalances`. */
  loans: { id: string; label: string }[];
}

type SavingsField = "movingSavings" | "emergencySavings" | "freeSavings";

const SAVINGS_FIELDS: { name: SavingsField; label: string }[] = [
  { name: "movingSavings", label: "Épargne déménagement" },
  { name: "emergencySavings", label: "Fonds d’urgence" },
  { name: "freeSavings", label: "Épargne libre" },
];

export function CheckInForm({ months, values, existing, planned, loans }: CheckInFormProps) {
  const [state, action, pending] = useActionState<SaveActualState, FormData>(saveActualAction, { status: "idle" });
  const [form, setForm] = useState<ActualForm>(() => values[months[0] ?? ""]!);
  // Feedback of a previous submission is hidden once the user switches month.
  const [dismissed, setDismissed] = useState<SaveActualState | null>(null);
  const feedback = state === dismissed ? null : state;
  const errors = feedback?.status === "error" ? feedback.errors : {};

  const month = form.month;
  const plan = planned[month] ?? null;
  const alreadyEntered = existing.includes(month);

  function selectMonth(next: YearMonth) {
    setForm(values[next] ?? { ...form, month: next });
    setDismissed(state);
  }

  const setField = (name: keyof Omit<ActualForm, "loanBalances" | "month">, value: string) =>
    setForm((f) => ({ ...f, [name]: value }));
  const setLoan = (loanId: string, value: string) =>
    setForm((f) => ({ ...f, loanBalances: f.loanBalances.map((b) => (b.loanId === loanId ? { ...b, balance: value } : b)) }));

  const knownFields = new Set(["month", "income", "expenses", ...SAVINGS_FIELDS.map((f) => f.name), ...loans.map((l) => `loan.${l.id}`)]);
  const orphanErrors = Object.entries(errors).filter(([key]) => !knownFields.has(key));

  return (
    <form action={action} noValidate className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Les champs marqués d’un * sont obligatoires. Montants en euros, ex. 1 234,56.</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="suivi-month">Mois</Label>
        <select
          id="suivi-month"
          name="month"
          value={month}
          onChange={(e) => selectMonth(e.target.value)}
          aria-invalid={errors.month ? true : undefined}
          aria-describedby={[alreadyEntered ? "suivi-month-existing" : "", errors.month ? "suivi-month-error" : ""].join(" ").trim() || undefined}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonthLong(m)}
              {existing.includes(m) ? " (saisi)" : ""}
            </option>
          ))}
        </select>
        {alreadyEntered ? (
          <p id="suivi-month-existing" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            Déjà saisi — la modification remplacera la saisie
          </p>
        ) : null}
        <FieldError id="suivi-month-error" message={errors.month} />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold">Épargne (soldes réels en fin de mois)</legend>
        {SAVINGS_FIELDS.map((field) => (
          <AmountField
            key={field.name}
            id={`suivi-${field.name}`}
            name={field.name}
            label={field.label}
            required
            value={form[field.name]}
            onChange={(v) => setField(field.name, v)}
            planned={plan ? plan[field.name] : null}
            error={errors[field.name]}
          />
        ))}
      </fieldset>

      {loans.length > 0 ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-1 text-base font-semibold">Capital restant dû réel (relevé banque)</legend>
          {loans.map((loan, j) => (
            <AmountField
              key={loan.id}
              id={`suivi-loan-${loan.id}`}
              name={`loan.${loan.id}`}
              label={loan.label}
              required
              value={form.loanBalances.find((b) => b.loanId === loan.id)?.balance ?? ""}
              onChange={(v) => setLoan(loan.id, v)}
              planned={plan?.loanBalances[j] ?? null}
              error={errors[`loan.${loan.id}`]}
            />
          ))}
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-base font-semibold">Budget du mois (facultatif, pour information)</legend>
        <AmountField
          id="suivi-income"
          name="income"
          label="Revenus réels"
          value={form.income}
          onChange={(v) => setField("income", v)}
          planned={plan?.income ?? null}
          error={errors.income}
        />
        <AmountField
          id="suivi-expenses"
          name="expenses"
          label="Dépenses réelles (hors crédits)"
          value={form.expenses}
          onChange={(v) => setField("expenses", v)}
          planned={plan?.expenses ?? null}
          error={errors.expenses}
        />
      </fieldset>

      <div id="suivi-form-feedback" aria-live="polite" className="empty:hidden">
        {feedback?.status === "saved" ? (
          <div role="status" className="flex flex-col gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
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
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
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

      {/* Stays visible above the mobile tab bar while scrolling the form (the Card must not clip overflow). */}
      <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t bg-card/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button type="submit" disabled={pending} className="h-12 w-full text-base md:w-auto md:px-6">
          {pending ? "Enregistrement…" : "Enregistrer le mois"}
        </Button>
      </div>
    </form>
  );
}

function AmountField({
  id,
  name,
  label,
  required = false,
  value,
  onChange,
  planned,
  error,
}: {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  planned: number | null;
  error: string | undefined;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [planned !== null ? hintId : "", error ? errorId : ""].join(" ").trim() || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-muted-foreground" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      <div className="relative">
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
          className="h-11 pr-8 text-base"
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
          €
        </span>
      </div>
      {planned !== null ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          Prévu : {formatEuros(planned)}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-red-700">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      {message}
    </p>
  );
}
