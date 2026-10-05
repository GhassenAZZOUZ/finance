"use client";

/**
 * Phone layout of /budget (#111; docs/design/MOBILE.md §2, mockups MobileBudget / MobileBudgetSheet):
 * a sticky header with the margin card and three tabs. « Mois type » lists the lines by group; a line
 * opens a bottom sheet and each sheet save sends the full budget through the desktop action, so there
 * is no global « Enregistrer ». « Ponctuel » is the exceptions card, « Objectifs » the goals card and
 * the plan parameters (the desktop form in its parameters-only mode).
 */
import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useActionState, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { BudgetCategory, BudgetException, BudgetLine, BudgetSettings, Loan, SavingsGoal } from "@/lib/domain/types";
import { parseAmount } from "@/lib/domain/validation";
import type { Cents, YearMonth } from "@/lib/engine";
import { formatEuros } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type BudgetActionState, saveBudgetAction } from "./actions";
import { BudgetForm } from "./budget-form";
import {
  type BudgetFormState,
  type LineState,
  computePreview,
  hasPeriod,
  initialFormState,
  overlapWarnings,
  periodText,
  linePeriod,
  sectionTotal,
  toPayload,
} from "./budget-form-state";
import { ExceptionsCard } from "./exceptions-card";
import { defaultExceptionMonth } from "./exceptions-view";

const GROUPS: { category: BudgetCategory; title: string; add: string; dot: string }[] = [
  { category: "income", title: "Revenus", add: "Ajouter un revenu", dot: "bg-good" },
  { category: "fixed", title: "Charges fixes", add: "Ajouter une charge", dot: "bg-bucket-fixed" },
  { category: "variable", title: "Dépenses variables", add: "Ajouter une dépense", dot: "bg-bucket-expenses" },
];

const TABS = [
  { id: "lines", label: "Mois type" },
  { id: "oneoff", label: "Ponctuel" },
  { id: "goals", label: "Objectifs" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isZero = (amount: string) => /^0+([,.]0*)?$/.test(amount.trim());

function amountOf(line: LineState): Cents {
  const parsed = parseAmount(line.amount);
  return parsed.ok ? (parsed.value ?? 0) : 0;
}

/** What the sheet edits: an existing line (by key) or a new one in a group. */
type Editing = { key: string } | { category: BudgetCategory };

export interface MobileBudgetProps {
  settings: BudgetSettings | null;
  lines: BudgetLine[];
  loans: Loan[];
  exceptions: BudgetException[];
  goals: SavingsGoal[];
  currentMonth: YearMonth;
}

export function MobileBudget(props: MobileBudgetProps) {
  const { settings, lines, loans, exceptions, goals, currentMonth } = props;
  // A first visit has no parameters yet: they come first.
  const [tab, setTab] = useState<TabId>(settings ? "lines" : "goals");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showZero, setShowZero] = useState<Partial<Record<BudgetCategory, boolean>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const saved = useMemo(() => initialFormState(settings, lines, currentMonth), [settings, lines, currentMonth]);
  const savedStart = settings?.startMonth ?? null;
  const preview = useMemo(
    () => computePreview(saved, loans, exceptions, { currentMonth, savedStartMonth: savedStart, goals }),
    [saved, loans, exceptions, currentMonth, savedStart, goals],
  );
  const planStart = settings?.startMonth ?? null;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`budget-tab-${next.id}`)?.focus();
  };

  const editingLine = editing && "key" in editing ? (saved.lines.find((l) => l.key === editing.key) ?? null) : null;
  const sheetCategory = editing ? ("key" in editing ? editingLine?.category : editing.category) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-3 bg-background px-4 pt-1 pb-3">
        <h1 className="font-heading text-[28px] leading-[1.15] font-medium tracking-[-0.01em]">Budget</h1>
        <MarginBar income={preview.income} fixed={preview.fixed} variable={preview.variable} loans={preview.loanPayments} margin={preview.margin} />
        <div role="tablist" aria-label="Sections du budget" className="grid grid-cols-3 rounded-full bg-secondary p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`budget-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`budget-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
              className={cn(
                "min-h-10 rounded-full text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                tab === t.id ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p role="status" className={notice ? "rounded-xl border border-good-border bg-good-bg px-3 py-2 text-sm text-good" : "sr-only"}>
        {notice}
      </p>

      <div id="budget-panel-lines" role="tabpanel" aria-labelledby="budget-tab-lines" hidden={tab !== "lines"} className="flex flex-col gap-5">
        {settings ? null : (
          <p className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
            Commencez par les paramètres du plan, dans l’onglet « Objectifs ».
          </p>
        )}
        {GROUPS.map((group) => {
          const groupLines = saved.lines.filter((l) => l.category === group.category);
          const zero = groupLines.filter((l) => isZero(l.amount) && !hasPeriod(l));
          const shown = showZero[group.category] ? groupLines : groupLines.filter((l) => !zero.includes(l));
          const headingId = `mobile-group-${group.category}`;
          return (
            <section key={group.category} role="group" aria-labelledby={headingId} className="flex flex-col gap-2">
              <h2 id={headingId} className="flex items-center justify-between gap-3 text-[15px] font-semibold">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2.5 rounded-[3px]", group.dot)} />
                  {group.title}
                </span>
                <span className="tabular-nums">{formatEuros(sectionTotal(saved.lines, group.category, preview.referenceMonth))}</span>
              </h2>
              <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-2xl border bg-card">
                {shown.map((line) => (
                  <li key={line.key}>
                    <LineButton line={line} onOpen={() => setEditing({ key: line.key })} />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setEditing({ category: group.category })}
                    className="flex min-h-13 w-full items-center gap-2 px-4 text-left text-[15px] font-medium text-link focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <Plus aria-hidden className="size-4" />
                    {group.add}
                  </button>
                </li>
              </ul>
              {zero.length > 0 && !showZero[group.category] ? (
                <p className="text-[13px] text-muted-foreground">
                  {zero.length === 1 ? "1 ligne à 0 € masquée" : `${zero.length} lignes à 0 € masquées`} ·{" "}
                  <button
                    type="button"
                    onClick={() => setShowZero((z) => ({ ...z, [group.category]: true }))}
                    aria-label={`Afficher ${zero.length === 1 ? "la ligne" : `les ${zero.length} lignes`} à 0 € : ${group.title}`}
                    className="min-h-11 font-medium text-link underline underline-offset-4"
                  >
                    Afficher
                  </button>
                </p>
              ) : null}
            </section>
          );
        })}
        <section role="group" aria-labelledby="mobile-group-loans" className="flex flex-col gap-2">
          <h2 id="mobile-group-loans" className="flex items-center justify-between gap-3 text-[15px] font-semibold">
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-bucket-debts" />
              Mensualités de crédit
            </span>
            <span className="tabular-nums">{formatEuros(preview.loanPayments)}</span>
          </h2>
          <Link
            href="/credits"
            className="flex min-h-13 items-center justify-between rounded-2xl border bg-card px-4 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-ring"
          >
            {loans.length === 0 ? "Aucun crédit · ajouter dans Crédits" : `${loans.length} crédit${loans.length > 1 ? "s" : ""} · gérer dans Crédits`}
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        </section>
      </div>

      <div id="budget-panel-oneoff" role="tabpanel" aria-labelledby="budget-tab-oneoff" hidden={tab !== "oneoff"}>
        <ExceptionsCard
          exceptions={exceptions}
          startMonth={planStart}
          defaultMonth={defaultExceptionMonth(planStart, currentMonth)}
          hasSettings={settings !== null}
          currentMonth={currentMonth}
        />
      </div>

      <div id="budget-panel-goals" role="tabpanel" aria-labelledby="budget-tab-goals" hidden={tab !== "goals"}>
        {tab === "goals" ? (
          <BudgetForm
            settings={settings}
            lines={lines}
            loans={loans}
            exceptions={exceptions}
            goals={goals}
            currentMonth={currentMonth}
            paramsOnly
          />
        ) : null}
      </div>

      <Sheet
        open={editing !== null && sheetCategory !== undefined}
        title={editingLine ? `Modifier « ${editingLine.label || "ligne sans nom"} »` : (GROUPS.find((g) => g.category === sheetCategory)?.add ?? "")}
        onClose={() => setEditing(null)}
      >
        {sheetCategory ? (
          <LineSheet
            key={editingLine?.key ?? `new-${sheetCategory}`}
            saved={saved}
            line={editingLine}
            category={sheetCategory}
            loans={loans}
            exceptions={exceptions}
            goals={goals}
            currentMonth={currentMonth}
            savedStartMonth={savedStart}
            onDone={(message) => {
              setEditing(null);
              setNotice(message);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

/** Margin of the reference month and where the income goes, as one stacked bar. */
function MarginBar({ income, fixed, variable, loans, margin }: { income: Cents; fixed: Cents; variable: Cents; loans: Cents; margin: Cents }) {
  const parts = [
    { label: "Charges fixes", value: fixed, className: "bg-bucket-fixed" },
    { label: "Dépenses variables", value: variable, className: "bg-bucket-expenses" },
    { label: "Mensualités", value: loans, className: "bg-bucket-debts" },
    { label: "Marge", value: Math.max(0, margin), className: "bg-good" },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <section aria-label="Marge du mois" className="flex flex-col gap-2 rounded-2xl bg-foreground px-4 py-3 text-background">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] opacity-75">Marge du mois</span>
        <span className={cn("font-heading text-2xl font-medium tabular-nums", margin < 0 && "text-bad-bg")}>{formatEuros(margin)}</span>
      </p>
      {total > 0 ? (
        <div
          role="img"
          aria-label={`Revenus ${formatEuros(income)} : ${parts.map((p) => `${p.label} ${formatEuros(p.value)}`).join(", ")}`}
          className="flex h-2 gap-px overflow-hidden rounded-full bg-background/20"
        >
          {parts.map((p) => (
            <span key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LineButton({ line, onOpen }: { line: LineState; onOpen: () => void }) {
  const period = periodText(linePeriod(line));
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px]">{line.label || "Ligne sans nom"}</span>
        {period ? <span className="text-[13px] text-good">{period}</span> : null}
      </span>
      <span className="text-[15px] font-medium tabular-nums">{formatEuros(amountOf(line))}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

const INITIAL: BudgetActionState = { status: "idle", errors: {}, lineKeys: [] };
type PeriodPart = "start" | "end";

function LineSheet({
  saved,
  line,
  category,
  loans,
  exceptions,
  goals,
  currentMonth,
  savedStartMonth,
  onDone,
  onCancel,
}: {
  saved: BudgetFormState;
  savedStartMonth: YearMonth | null;
  /** Null: a new line in `category`. */
  line: LineState | null;
  category: BudgetCategory;
  loans: Loan[];
  exceptions: BudgetException[];
  goals: SavingsGoal[];
  currentMonth: YearMonth;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const key = line?.key ?? "mobile-new";
  const [draft, setDraft] = useState<LineState>(line ?? { key, category, label: "", amount: "", startMonth: "", endMonth: "" });
  const [periods, setPeriods] = useState<Record<PeriodPart, boolean>>({ start: draft.startMonth !== "", end: draft.endMonth !== "" });
  const [confirming, setConfirming] = useState(false);

  const withDraft = (remove: boolean): BudgetFormState => {
    const edited = { ...draft, startMonth: periods.start ? draft.startMonth : "", endMonth: periods.end ? draft.endMonth : "" };
    if (remove) return { ...saved, lines: saved.lines.filter((l) => l.key !== key) };
    return { ...saved, lines: line ? saved.lines.map((l) => (l.key === key ? edited : l)) : [...saved.lines, edited] };
  };
  const next = withDraft(false);

  const [state, action, pending] = useActionState<BudgetActionState, FormData>(async (prev, formData) => {
    const remove = formData.get("intent") === "delete";
    const body = new FormData();
    body.set("payload", JSON.stringify(toPayload(withDraft(remove))));
    const result = await saveBudgetAction(prev, body);
    if (result.status === "success") {
      const name = draft.label.trim() || "La ligne";
      onDone(remove ? `« ${name} » a été supprimée.` : line ? `« ${name} » a été enregistrée.` : `« ${name} » a été ajoutée.`);
    }
    return result;
  }, INITIAL);

  const margin = computePreview(next, loans, exceptions, { currentMonth, savedStartMonth, goals }).margin;
  const overlap = overlapWarnings(next.lines)[key];
  const index = state.lineKeys.indexOf(key);
  const fieldError = (field: string) => (index >= 0 ? state.errors[`lines.${index}.${field}`] : undefined);
  const paramErrors = Object.keys(state.errors).some((k) => !k.startsWith("lines."));
  const id = (field: string) => `sheet-${field}`;
  const amountError = fieldError("amount");
  const labelError = fieldError("label");
  const startError = fieldError("startMonth");
  const endError = fieldError("endMonth");

  const chip = (active: boolean) =>
    cn(
      "min-h-10 rounded-full border px-3.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      active ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
    );

  return (
    <form action={action} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id("amount")} className="text-sm font-medium">
          Montant mensuel (€)
        </label>
        <input
          id={id("amount")}
          value={draft.amount}
          onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0,00"
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? `${id("amount")}-error` : undefined}
          className="h-16 rounded-[14px] border border-input bg-card px-4 text-[30px] font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-bad"
        />
        {amountError ? (
          <p id={`${id("amount")}-error`} className="text-sm text-bad">
            {amountError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={id("label")} className="text-sm font-medium">
          Libellé
        </label>
        <input
          id={id("label")}
          value={draft.label}
          onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
          maxLength={100}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? `${id("label")}-error` : undefined}
          className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px] focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-bad"
        />
        {labelError ? (
          <p id={`${id("label")}-error`} className="text-sm text-bad">
            {labelError}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Période</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!periods.start && !periods.end} onClick={() => setPeriods({ start: false, end: false })} className={chip(!periods.start && !periods.end)}>
            Tous les mois
          </button>
          <button type="button" aria-pressed={periods.start} onClick={() => setPeriods((p) => ({ ...p, start: !p.start }))} className={chip(periods.start)}>
            À partir de…
          </button>
          <button type="button" aria-pressed={periods.end} onClick={() => setPeriods((p) => ({ ...p, end: !p.end }))} className={chip(periods.end)}>
            Jusqu’à…
          </button>
        </div>
        {periods.start ? (
          <MonthField id={id("start")} label="À partir de" value={draft.startMonth} error={startError} onChange={(v) => setDraft((d) => ({ ...d, startMonth: v }))} />
        ) : null}
        {periods.end ? (
          <MonthField id={id("end")} label="Jusqu’à" value={draft.endMonth} error={endError} onChange={(v) => setDraft((d) => ({ ...d, endMonth: v }))} />
        ) : null}
      </fieldset>

      <p className="rounded-xl bg-secondary px-3 py-2.5 text-sm tabular-nums" aria-live="polite">
        Nouvelle marge : <b className={margin < 0 ? "text-bad" : undefined}>{formatEuros(margin)}</b>
      </p>
      {overlap ? (
        <p className="flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {overlap}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="rounded-xl border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
          {paramErrors ? "Paramètres du plan incomplets : complétez d’abord l’onglet « Objectifs »." : state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5">
        {line ? (
          confirming ? (
            <>
              <Button type="submit" name="intent" value="delete" variant="destructive" disabled={pending} className="min-h-11">
                Confirmer la suppression
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} className="min-h-11">
                Garder
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirming(true)} className="min-h-11 text-bad hover:text-bad">
              Supprimer
            </Button>
          )
        ) : (
          <Button type="button" variant="ghost" onClick={onCancel} className="min-h-11">
            Annuler
          </Button>
        )}
        <Button key="save" type="submit" name="intent" value="save" disabled={pending} className="ml-auto min-h-11 px-5 text-[15px]">
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

function MonthField({ id, label, value, error, onChange }: { id: string; label: string; value: string; error?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <input
        id={id}
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-11 rounded-[10px] border border-input bg-card px-3 text-[15px] aria-invalid:border-bad"
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
