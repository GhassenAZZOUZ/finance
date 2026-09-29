"use client";

import { type ReactNode, useActionState, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarRange, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetCategory, BudgetException, BudgetLine, BudgetSettings, Loan, SavingsGoal } from "@/lib/domain/types";
import type { YearMonth } from "@/lib/engine";
import { amountInputValue, formatEuros, formatMonthShort } from "@/lib/format";
import { type BudgetActionState, saveBudgetAction } from "./actions";
import {
  type BudgetFormState,
  type LineState,
  type ParamField,
  computePreview,
  formPlanStart,
  formSignature,
  hasPeriod,
  initialFormState,
  invalidParams,
  isOutsidePlan,
  linePeriod,
  parseSettings,
  periodText,
  sectionTotal,
  toPayload,
} from "./budget-form-state";
import { BudgetSummary, PARAM_LABEL } from "./budget-summary";
import { ExceptionsCard } from "./exceptions-card";
import { GoalsCard } from "./goals-card";
import { defaultExceptionMonth } from "./exceptions-view";

const SECTIONS: { category: BudgetCategory; title: string; note?: string; lineName: string; add: string; dot: string }[] = [
  { category: "income", title: "Revenus nets mensuels", lineName: "Revenu", add: "Ajouter un revenu", dot: "bg-good" },
  {
    category: "fixed",
    title: "Charges fixes",
    note: "hors mensualités de crédit",
    lineName: "Charge",
    add: "Ajouter une charge",
    dot: "bg-bucket-fixed",
  },
  {
    category: "variable",
    title: "Dépenses variables",
    note: "moyenne sur 3 mois",
    lineName: "Dépense",
    add: "Ajouter une dépense",
    dot: "bg-bucket-expenses",
  },
];

/** Saved lines at 0 € (without a period) are folded away, still saved, until "Afficher" is pressed. */
function isFoldable(line: LineState, savedAmounts: ReadonlyMap<string, string>): boolean {
  const zero = (v: string | undefined) => v !== undefined && /^0+([,.]0*)?$/.test(v.trim());
  return zero(savedAmounts.get(line.key)) && zero(line.amount) && !hasPeriod(line);
}

const FORM_ID = "budget-form";

const INITIAL_ACTION_STATE: BudgetActionState = { status: "idle", errors: {}, lineKeys: [] };

type LineFieldErrors = { label?: string; amount?: string; startMonth?: string; endMonth?: string };
type LineErrors = Map<string, LineFieldErrors>;
type LinePatch = Partial<Pick<LineState, "label" | "amount" | "startMonth" | "endMonth">>;

export function BudgetForm({
  settings,
  lines,
  loans,
  exceptions,
  goals = [],
  currentMonth,
}: {
  settings: BudgetSettings | null;
  lines: BudgetLine[];
  loans: Loan[];
  /** Saved one-off exceptions (SPEC D14): managed by their own card, included in the preview. */
  exceptions: BudgetException[];
  /** Savings goals (SPEC D23): managed by their own card, included in the preview. */
  goals?: SavingsGoal[];
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
  const savedStart = settings?.startMonth ?? null;
  const preview = useMemo(
    () => computePreview(form, loans, exceptions, { currentMonth, savedStartMonth: savedStart, goals }),
    [form, loans, exceptions, currentMonth, savedStart, goals],
  );
  const missingParams = useMemo(() => invalidParams(form.params), [form.params]);
  const goalsTitle = goals.length === 1 ? goals[0]!.name : "Objectifs d’épargne";
  // Plan start for the exceptions' "outside the plan" notes: the live value when valid, else the saved one.
  const planStart = useMemo(() => parseSettings(form.params)?.startMonth ?? settings?.startMonth ?? null, [form.params, settings]);
  // Plan start for the lines' "outside the plan" notes: the typed month as soon as it is valid.
  const linePlanStart = formPlanStart(form.params, savedStart);

  const errors = actionState.errors;
  const lineErrors: LineErrors = new Map();
  actionState.lineKeys.forEach((key, i) => {
    const label = errors[`lines.${i}.label`];
    const amount = errors[`lines.${i}.amount`];
    const startMonth = errors[`lines.${i}.startMonth`];
    const endMonth = errors[`lines.${i}.endMonth`];
    if (label || amount || startMonth || endMonth) lineErrors.set(key, { label, amount, startMonth, endMonth });
  });
  const errorCount = Object.keys(errors).length;

  const savedAmounts = useMemo(() => new Map(saved.lines.map((l) => [l.key, l.amount])), [saved]);
  const [showZero, setShowZero] = useState<Partial<Record<BudgetCategory, boolean>>>({});
  const movingKpis = preview.plan?.kpis ?? null;

  const nextKey = useRef(0);
  const focusKey = useRef<string | null>(null);
  const addButtons = useRef<Partial<Record<BudgetCategory, HTMLButtonElement | null>>>({});

  const setParam = (field: ParamField, value: string) => setForm((f) => ({ ...f, params: { ...f.params, [field]: value } }));
  const updateLine = (key: string, patch: LinePatch) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const addLine = (category: BudgetCategory) => {
    const key = `new-${++nextKey.current}`;
    focusKey.current = key;
    setForm((f) => ({ ...f, lines: [...f.lines, { key, category, label: "", amount: "0", startMonth: "", endMonth: "" }] }));
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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22.5rem]">
      {/* The exceptions card has its own <form> (forms cannot nest), so the budget form only wraps the
          sections and the parameters; the "Enregistrer" button in the aside submits it through form=. */}
      <div className="flex min-w-0 flex-col gap-6">
        <form id={FORM_ID} action={formAction} noValidate className="flex flex-col gap-6">
          <input type="hidden" name="payload" value={JSON.stringify(toPayload(form))} />

          {SECTIONS.map((section) => {
            const sectionLines = form.lines.filter((l) => l.category === section.category);
            const headingId = `section-${section.category}`;
            // With dated lines the total depends on the month: say which one it describes.
            const totalMonth = sectionLines.some(hasPeriod) ? preview.referenceMonth : null;
            const folded = showZero[section.category]
              ? []
              : sectionLines.filter((l) => isFoldable(l, savedAmounts) && !lineErrors.has(l.key));
            return (
              <section
                key={section.category}
                role="group"
                aria-labelledby={headingId}
                className="flex flex-col gap-3 rounded-2xl border bg-card px-4 py-5 md:px-6"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2 id={headingId} className="flex flex-wrap items-center gap-x-2.5 text-[17px] font-semibold">
                    <span aria-hidden className={`size-2.5 rounded-[3px] ${section.dot}`} />
                    {section.title}
                    {section.note ? <span className="text-sm font-normal text-muted-foreground">{section.note}</span> : null}
                  </h2>
                  <p className="shrink-0 text-[17px] font-semibold tabular-nums">
                    <span className="sr-only">{totalMonth ? `Total (${formatMonthShort(totalMonth)}) : ` : "Total : "}</span>
                    {totalMonth ? (
                      <span aria-hidden className="mr-1.5 text-[13px] font-normal text-muted-foreground">
                        {formatMonthShort(totalMonth)}
                      </span>
                    ) : null}
                    {formatEuros(sectionTotal(form.lines, section.category, preview.referenceMonth))}
                  </p>
                </div>
                {sectionLines.length === 0 ? <p className="text-sm text-muted-foreground">Aucune ligne.</p> : null}
                <ul className="flex flex-col gap-2">
                  {sectionLines.map((line, i) =>
                    folded.includes(line) ? null : (
                      <LineRow
                        key={line.key}
                        line={line}
                        name={`${section.lineName} ${i + 1}`}
                        errors={lineErrors.get(line.key)}
                        planStart={linePlanStart}
                        inputRef={focusNewLine(line.key)}
                        onChange={(patch) => updateLine(line.key, patch)}
                        onRemove={() => removeLine(line)}
                      />
                    ),
                  )}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-x-3">
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-10 px-2.5 text-link hover:text-link"
                    ref={(el) => {
                      addButtons.current[section.category] = el;
                    }}
                    onClick={() => addLine(section.category)}
                  >
                    <Plus aria-hidden />
                    {section.add}
                  </Button>
                  {folded.length > 0 ? (
                    <p className="text-[13px] text-muted-foreground">
                      {folded.length === 1 ? "1 ligne à 0,00 € masquée" : `${folded.length} lignes à 0,00 € masquées`} ·{" "}
                      <button
                        type="button"
                        className="min-h-10 font-medium text-link underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setShowZero((z) => ({ ...z, [section.category]: true }))}
                        aria-label={`Afficher ${folded.length === 1 ? "la ligne" : `les ${folded.length} lignes`} à 0,00 € : ${section.title}`}
                      >
                        Afficher
                      </button>
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}

          <section
            role="group"
            aria-labelledby="section-params"
            className="flex flex-col gap-5 rounded-2xl border bg-card px-4 py-5 md:px-6"
          >
            <h2 id="section-params" className="text-[17px] font-semibold">
              Paramètres du plan
            </h2>

            <ParamGroup title={`① ${goalsTitle}`} dot="bg-bucket-moving">
              <p className="text-[13px] text-muted-foreground sm:col-span-3">
                Montants visés, dates limites et priorités : dans{" "}
                <a href="#section-goals" className="font-medium text-foreground underline underline-offset-2">
                  Objectifs d’épargne
                </a>
                , plus bas.
              </p>
              {movingKpis && movingKpis.movingGoal > 0 && !movingKpis.deadlineBeforeStart && movingKpis.movingMonthlyNeeded > preview.margin ? (
                <p className="rounded-[10px] bg-warning-bg px-3 py-2.5 text-[13px] text-warning tabular-nums sm:col-span-3">
                  Il faudrait {formatEuros(movingKpis.movingMonthlyNeeded)} par mois ; la marge n’est que de{" "}
                  {formatEuros(preview.margin)}
                  {preview.referenceMonth ? ` en ${formatMonthShort(preview.referenceMonth)}` : ""}.
                </p>
              ) : null}
            </ParamGroup>

            <ParamGroup title="② Fonds d’urgence" dot="bg-bucket-emergency">
              <ParamInput
                {...paramProps("emergencyTarget")}
                kind="amount"
                hint={`Conseillé : 3 mois de charges et mensualités = ${formatEuros(preview.suggestedEmergencyTarget)}.`}
                extra={
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-10 self-start px-1.5 text-link hover:text-link"
                    onClick={() => setParam("emergencyTarget", amountInputValue(preview.suggestedEmergencyTarget))}
                  >
                    Utiliser cette valeur
                  </Button>
                }
              />
              <ParamInput {...paramProps("emergencyExisting")} kind="amount" />
            </ParamGroup>

            <ParamGroup title="③ Reste du mois" dot="bg-bucket-debts">
              <ParamInput
                {...paramProps("riskFreeRate")}
                kind="percent"
                placeholder="Taux en %"
                hint="Taux actuel du Livret A. Un crédit au TAEG supérieur est remboursé en priorité."
              />
              <SharePicker {...paramProps("earlyRepaymentPct")} />
            </ParamGroup>

            <div className="grid gap-4 border-t border-divider pt-4 sm:grid-cols-3">
              <ParamInput {...paramProps("startMonth")} kind="month" hint="Premier mois simulé." />
              <ParamInput
                {...paramProps("freeSavingsExisting")}
                kind="amount"
                hint="Épargne disponible hors objectifs d’épargne et fonds d’urgence au début du plan (0 si aucune)."
              />
            </div>
          </section>
        </form>

        <GoalsCard
          goals={goals}
          kpis={preview.plan?.kpis.goals ?? null}
          hasSettings={settings !== null}
          currentMonth={currentMonth}
        />

        <ExceptionsCard
          exceptions={exceptions}
          startMonth={planStart}
          defaultMonth={defaultExceptionMonth(settings?.startMonth ?? null, currentMonth)}
          hasSettings={settings !== null}
          currentMonth={currentMonth}
        />
      </div>

      <aside aria-labelledby="apercu-titre" className="lg:sticky lg:top-6">
        <BudgetSummary
          preview={preview}
          dirty={dirty}
          missingParams={missingParams}
          footer={
            <div className="flex flex-col gap-2 border-t border-divider pt-4">
              <Button type="submit" form={FORM_ID} disabled={pending} className="min-h-11 w-full text-[15px]">
                {pending ? "Enregistrement…" : "Enregistrer"}
              </Button>
              <div aria-live="polite" className="text-center text-[13px]">
                {actionState.status === "idle" && !pending ? (
                  <p className="text-muted-foreground">{dirty ? "Modifications non enregistrées" : "Tout est enregistré"}</p>
                ) : null}
                {actionState.status === "error" ? (
                  <p className="text-bad">
                    {actionState.message}
                    {errorCount > 0 ? ` (${errorCount} erreur${errorCount > 1 ? "s" : ""})` : null}
                  </p>
                ) : null}
                {actionState.status === "success" && !dirty && !pending ? (
                  <p className="text-good">✓ {actionState.message}</p>
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
  planStart,
  inputRef,
  onChange,
  onRemove,
}: {
  line: LineState;
  name: string;
  errors?: LineFieldErrors;
  /** Plan start, to flag a period that never meets the simulated months (null: unknown). */
  planStart: string | null;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (patch: LinePatch) => void;
  onRemove: () => void;
}) {
  const id = `line-${line.key}`;
  const shown = line.label.trim() || name;
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const periodErrors = Boolean(errors?.startMonth || errors?.endMonth);
  // A period error keeps the fields visible so the message sits next to its input.
  const expanded = open || periodErrors;
  const period = linePeriod(line);
  const summary = periodText(period);
  const outside = isOutsidePlan(period, planStart);
  const periodId = `${id}-period`;
  const clearPeriod = () => {
    onChange({ startMonth: "", endMonth: "" });
    setOpen(false);
    toggleRef.current?.focus();
  };
  return (
    <li className="grid grid-cols-[2.625rem_minmax(0,1fr)_2.625rem] gap-2 sm:grid-cols-[minmax(0,1fr)_2.625rem_10.5rem_2.625rem] sm:items-start">
      <div className="col-span-3 flex flex-col gap-1 sm:col-span-1">
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
          className="h-10.5"
          aria-invalid={errors?.label ? true : undefined}
          aria-describedby={errors?.label ? `${id}-label-error` : undefined}
        />
        {errors?.label ? (
          <p id={`${id}-label-error`} className="text-sm text-bad">
            {errors.label}
          </p>
        ) : null}
      </div>
      <Button
        ref={toggleRef}
        type="button"
        variant="ghost"
        size="icon"
        className={`size-10.5 ${summary ? "bg-good-bg text-link" : "text-muted-foreground"} aria-expanded:bg-good-bg aria-expanded:text-link`}
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        aria-controls={periodId}
        aria-label={`Période (${shown})`}
        title="Période"
      >
        <CalendarRange aria-hidden className="size-4.5" />
      </Button>
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
            className="h-10.5 pr-7 text-right tabular-nums"
            aria-invalid={errors?.amount ? true : undefined}
            aria-describedby={[errors?.amount ? `${id}-amount-error` : null, summary ? `${periodId}-summary` : null].filter(Boolean).join(" ") || undefined}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            €
          </span>
        </div>
        {errors?.amount ? (
          <p id={`${id}-amount-error`} className="text-sm text-bad">
            {errors.amount}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10.5 text-muted-foreground"
        onClick={onRemove}
        aria-label={`Supprimer ${shown}`}
      >
        <Trash2 aria-hidden className="size-4.5" />
      </Button>
      {summary && (!expanded || outside) ? (
        <p id={`${periodId}-summary`} className="col-span-full flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {expanded ? null : (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs font-medium">
              <CalendarRange aria-hidden className="size-3" />
              <span className="sr-only">Période : </span>
              {summary}
            </span>
          )}
          {outside ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle aria-hidden className="size-3.5" />
              hors de la période du plan : sans effet
            </span>
          ) : null}
        </p>
      ) : null}
      <div
        id={periodId}
        role="group"
        aria-label={`Période de ${shown}`}
        hidden={!expanded}
        className="col-span-full rounded-xl border border-good-border bg-good-subtle p-3.5"
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
          <PeriodInput
            id={`${id}-start`}
            label="Début (inclus)"
            value={line.startMonth}
            error={errors?.startMonth}
            onChange={(startMonth) => onChange({ startMonth })}
          />
          <PeriodInput
            id={`${id}-end`}
            label="Fin (incluse)"
            value={line.endMonth}
            error={errors?.endMonth}
            onChange={(endMonth) => onChange({ endMonth })}
          />
          <Button type="button" variant="outline" className="min-h-10 sm:mt-6" onClick={clearPeriod} disabled={!line.startMonth && !line.endMonth}>
            Retirer la période
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {summary ? `Ligne prise en compte ${summary}.` : "Vide = sans limite : la ligne s’applique à tous les mois."}
        </p>
      </div>
    </li>
  );
}

function PeriodInput({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="month"
        autoComplete="off"
        value={value}
        placeholder="AAAA-MM"
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One fund of the parameters: coloured dot + legend, fields on three columns. */
function ParamGroup({ title, dot, children }: { title: string; dot: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4 sm:grid-cols-3 sm:items-start">
      <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden className={`size-2.5 rounded-[3px] ${dot}`} />
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Early-repayment share: a 0–100 slider and the same value as an editable percentage
 * (the text field stays the source of truth, so an empty value is reported like the others).
 */
function SharePicker({
  field,
  value,
  error,
  onChange,
}: {
  field: ParamField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `param-${field}`;
  const parsed = Number(value.replace(",", ".").trim());
  const pct = value.trim() !== "" && Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <Label htmlFor={id}>{PARAM_LABEL[field]}</Label>
      <div className="flex items-center gap-3.5">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct ?? 0}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${PARAM_LABEL[field]} (curseur)`}
          aria-valuetext={pct === null ? "non renseigné" : `${pct} %`}
          className="h-10.5 min-w-0 grow accent-bucket-debts"
        />
        <div className="relative w-24 shrink-0">
          <Input
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            placeholder="0 à 100"
            onChange={(e) => onChange(e.target.value)}
            className="h-10.5 pr-7 text-right tabular-nums"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            %
          </span>
        </div>
      </div>
      <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted-foreground">
        {pct === null
          ? "Le reste va en épargne libre (0 % = aucun remboursement anticipé)."
          : `Les ${Math.round((100 - pct) * 100) / 100} % restants vont en épargne libre.`}
      </p>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
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
        className={`h-10.5 ${kind === "month" ? "" : "text-right tabular-nums"}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {extra}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
