"use client";

import { type ReactNode, useActionState, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetCategory, BudgetException, BudgetLine, BudgetSettings, Loan } from "@/lib/domain/types";
import type { YearMonth } from "@/lib/engine";
import { amountInputValue, formatEuros } from "@/lib/format";
import { type BudgetActionState, saveBudgetAction } from "./actions";
import {
  type BudgetFormState,
  type LineState,
  type ParamField,
  computePreview,
  formSignature,
  initialFormState,
  invalidParams,
  parseSettings,
  sectionTotal,
  toPayload,
} from "./budget-form-state";
import { BudgetSummary, PARAM_LABEL } from "./budget-summary";
import { ExceptionsCard } from "./exceptions-card";
import { defaultExceptionMonth } from "./exceptions-view";

const SECTIONS: { category: BudgetCategory; title: string; lineName: string }[] = [
  { category: "income", title: "Revenus nets mensuels", lineName: "Revenu" },
  { category: "fixed", title: "Charges fixes (hors mensualités de crédit)", lineName: "Charge" },
  { category: "variable", title: "Dépenses variables (moyenne sur 3 mois)", lineName: "Dépense" },
];

const FORM_ID = "budget-form";

const INITIAL_ACTION_STATE: BudgetActionState = { status: "idle", errors: {}, lineKeys: [] };

type LineErrors = Map<string, { label?: string; amount?: string }>;

export function BudgetForm({
  settings,
  lines,
  loans,
  exceptions,
  currentMonth,
}: {
  settings: BudgetSettings | null;
  lines: BudgetLine[];
  loans: Loan[];
  /** Saved one-off exceptions (SPEC D14): managed by their own card, included in the preview. */
  exceptions: BudgetException[];
  currentMonth: YearMonth;
}) {
  const saved = useMemo(() => initialFormState(settings, lines, currentMonth), [settings, lines, currentMonth]);
  const savedSignature = formSignature(saved);
  const [form, setForm] = useState<BudgetFormState>(saved);
  // Resync with the server data after a save (refresh() sends new props). Unchanged data keeps the edits.
  const [syncedSignature, setSyncedSignature] = useState(savedSignature);
  if (syncedSignature !== savedSignature) {
    setSyncedSignature(savedSignature);
    setForm(saved);
  }

  const [actionState, formAction, pending] = useActionState(saveBudgetAction, INITIAL_ACTION_STATE);
  const dirty = formSignature(form) !== savedSignature;
  const preview = useMemo(() => computePreview(form, loans, exceptions), [form, loans, exceptions]);
  const missingParams = useMemo(() => invalidParams(form.params), [form.params]);
  // Plan start for the exceptions' "outside the plan" notes: the live value when valid, else the saved one.
  const planStart = useMemo(() => parseSettings(form.params)?.startMonth ?? settings?.startMonth ?? null, [form.params, settings]);

  const errors = actionState.errors;
  const lineErrors: LineErrors = new Map();
  actionState.lineKeys.forEach((key, i) => {
    const label = errors[`lines.${i}.label`];
    const amount = errors[`lines.${i}.amount`];
    if (label || amount) lineErrors.set(key, { label, amount });
  });
  const errorCount = Object.keys(errors).length;

  const nextKey = useRef(0);
  const focusKey = useRef<string | null>(null);
  const addButtons = useRef<Partial<Record<BudgetCategory, HTMLButtonElement | null>>>({});

  const setParam = (field: ParamField, value: string) => setForm((f) => ({ ...f, params: { ...f.params, [field]: value } }));
  const updateLine = (key: string, patch: Partial<Pick<LineState, "label" | "amount">>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = (category: BudgetCategory) => {
    const key = `new-${++nextKey.current}`;
    focusKey.current = key;
    setForm((f) => ({ ...f, lines: [...f.lines, { key, category, label: "", amount: "0" }] }));
  };
  const removeLine = (line: LineState) => {
    setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== line.key) }));
    addButtons.current[line.category]?.focus();
  };
  const focusNewLine = (key: string) => (el: HTMLInputElement | null) => {
    if (el && focusKey.current === key) {
      focusKey.current = null;
      el.focus();
    }
  };

  const paramProps = (field: ParamField) => ({
    field,
    value: form.params[field],
    error: errors[field],
    onChange: (value: string) => setParam(field, value),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {/* The exceptions card has its own <form> (forms cannot nest), so the budget form only wraps the
          sections and the parameters; the "Enregistrer" button in the aside submits it through form=. */}
      <div className="flex min-w-0 flex-col gap-6">
        <form id={FORM_ID} action={formAction} noValidate className="flex flex-col gap-6">
          <input type="hidden" name="payload" value={JSON.stringify(toPayload(form))} />

          {SECTIONS.map((section) => {
            const sectionLines = form.lines.filter((l) => l.category === section.category);
            const headingId = `section-${section.category}`;
            return (
              <Card key={section.category} role="group" aria-labelledby={headingId}>
                <CardHeader>
                  <CardTitle id={headingId} role="heading" aria-level={2}>
                    {section.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {sectionLines.length === 0 ? <p className="text-sm text-muted-foreground">Aucune ligne.</p> : null}
                  <ul className="flex flex-col gap-3">
                    {sectionLines.map((line, i) => (
                      <LineRow
                        key={line.key}
                        line={line}
                        name={`${section.lineName} ${i + 1}`}
                        errors={lineErrors.get(line.key)}
                        inputRef={focusNewLine(line.key)}
                        onChange={(patch) => updateLine(line.key, patch)}
                        onRemove={() => removeLine(line)}
                      />
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10"
                      ref={(el) => {
                        addButtons.current[section.category] = el;
                      }}
                      onClick={() => addLine(section.category)}
                      aria-describedby={headingId}
                    >
                      <Plus aria-hidden />
                      Ajouter une ligne
                    </Button>
                    <p className="text-sm">
                      Total : <span className="font-semibold tabular-nums">{formatEuros(sectionTotal(form.lines, section.category))}</span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Card role="group" aria-labelledby="section-params">
            <CardHeader>
              <CardTitle id="section-params" role="heading" aria-level={2}>
                Paramètres du plan
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <ParamInput {...paramProps("startMonth")} kind="month" hint="Premier mois simulé." />
              <ParamInput {...paramProps("movingGoal")} kind="amount" />
              <ParamInput
                {...paramProps("movingDeadlineMonth")}
                kind="month"
                hint="Dernier mois qui reçoit encore de l’épargne pour le déménagement (inclus)."
              />
              <ParamInput {...paramProps("movingAlreadySaved")} kind="amount" />
              <ParamInput
                {...paramProps("emergencyTarget")}
                kind="amount"
                hint={`Suggestion : 3 × (charges fixes + dépenses variables + mensualités) = ${formatEuros(preview.suggestedEmergencyTarget)}.`}
                extra={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9 self-start"
                    onClick={() => setParam("emergencyTarget", amountInputValue(preview.suggestedEmergencyTarget))}
                  >
                    Utiliser cette valeur
                  </Button>
                }
              />
              <ParamInput {...paramProps("emergencyExisting")} kind="amount" />
              <ParamInput
                {...paramProps("riskFreeRate")}
                kind="percent"
                placeholder="Taux en %"
                hint="Mettez le taux actuel du Livret A. Un crédit au TAEG supérieur est rentable à rembourser par anticipation."
              />
              <ParamInput
                {...paramProps("earlyRepaymentPct")}
                kind="percent"
                placeholder="De 0 à 100"
                hint="Le reste va en épargne libre (0 % = aucun remboursement anticipé)."
              />
            </CardContent>
          </Card>
        </form>

        <ExceptionsCard
          exceptions={exceptions}
          startMonth={planStart}
          defaultMonth={defaultExceptionMonth(settings?.startMonth ?? null, currentMonth)}
          hasSettings={settings !== null}
        />
      </div>

      <aside aria-labelledby="apercu-titre" className="lg:sticky lg:top-20">
        <BudgetSummary
          preview={preview}
          dirty={dirty}
          missingParams={missingParams}
          footer={
            <div className="flex flex-col gap-2 border-t pt-3">
              <Button type="submit" form={FORM_ID} disabled={pending} className="min-h-11 w-full">
                {pending ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <div aria-live="polite" className="text-sm">
                {actionState.status === "error" ? (
                  <p className="text-red-700">
                    {actionState.message}
                    {errorCount > 0 ? ` (${errorCount} erreur${errorCount > 1 ? "s" : ""})` : null}
                  </p>
                ) : null}
                {actionState.status === "success" && !dirty && !pending ? (
                  <p className="text-green-800">✓ {actionState.message}</p>
                ) : null}
              </div>
            </div>
          }
        />
      </aside>
    </div>
  );
}

function LineRow({
  line,
  name,
  errors,
  inputRef,
  onChange,
  onRemove,
}: {
  line: LineState;
  name: string;
  errors?: { label?: string; amount?: string };
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (patch: Partial<Pick<LineState, "label" | "amount">>) => void;
  onRemove: () => void;
}) {
  const id = `line-${line.key}`;
  const shown = line.label.trim() || name;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-start">
      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
        <Label htmlFor={`${id}-label`} className="sr-only">
          Libellé ({name})
        </Label>
        <Input
          ref={inputRef}
          id={`${id}-label`}
          value={line.label}
          onChange={(e) => onChange({ label: e.target.value })}
          maxLength={100}
          placeholder="Libellé"
          className="h-10"
          aria-invalid={errors?.label ? true : undefined}
          aria-describedby={errors?.label ? `${id}-label-error` : undefined}
        />
        {errors?.label ? (
          <p id={`${id}-label-error`} className="text-sm text-red-700">
            {errors.label}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-amount`} className="sr-only">
          Montant mensuel en euros ({shown})
        </Label>
        <div className="relative">
          <Input
            id={`${id}-amount`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={line.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            className="h-10 pr-7 text-right tabular-nums"
            aria-invalid={errors?.amount ? true : undefined}
            aria-describedby={errors?.amount ? `${id}-amount-error` : undefined}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            €
          </span>
        </div>
        {errors?.amount ? (
          <p id={`${id}-amount-error`} className="text-sm text-red-700">
            {errors.amount}
          </p>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-10" onClick={onRemove} aria-label={`Supprimer ${shown}`}>
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

function ParamInput({
  field,
  kind,
  value,
  error,
  hint,
  placeholder,
  extra,
  onChange,
}: {
  field: ParamField;
  kind: "amount" | "percent" | "month";
  value: string;
  error?: string;
  hint?: string;
  placeholder?: string;
  extra?: ReactNode;
  onChange: (value: string) => void;
}) {
  const id = `param-${field}`;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const suffix = kind === "amount" ? "€" : kind === "percent" ? "%" : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {PARAM_LABEL[field]}
        {suffix ? <span className="text-muted-foreground">({suffix})</span> : null}
      </Label>
      <Input
        id={id}
        type={kind === "month" ? "month" : "text"}
        inputMode={kind === "month" ? undefined : "decimal"}
        autoComplete="off"
        value={value}
        placeholder={placeholder ?? (kind === "month" ? "AAAA-MM" : undefined)}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 ${kind === "month" ? "" : "tabular-nums"}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {extra}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
