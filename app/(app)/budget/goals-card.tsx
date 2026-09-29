"use client";

import { ArrowDown, ArrowUp, CheckCircle2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { engineGoalId } from "@/lib/domain/plan";
import { MAX_GOALS, type SavingsGoal } from "@/lib/domain/types";
import type { Errors, GoalForm } from "@/lib/domain/validation";
import type { GoalKpis, YearMonth } from "@/lib/engine";
import { amountInputValue, formatEuros, formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type GoalActionResult, addGoal, byPriority, deleteGoal, moveGoal, updateGoal } from "./goals-actions";

const EMPTY: GoalForm = { name: "", target: "", deadlineMonth: "", alreadySaved: "0" };

function readForm(event: FormEvent<HTMLFormElement>): GoalForm {
  const data = new FormData(event.currentTarget);
  const text = (key: string) => {
    const v = data.get(key);
    return typeof v === "string" ? v : "";
  };
  return { name: text("name"), target: text("target"), deadlineMonth: text("deadlineMonth"), alreadySaved: text("alreadySaved") };
}

/**
 * Savings goals (SPEC D23, issue #10): filled in priority order before the emergency fund, each
 * until its deadline. Saved immediately (outside the budget <form>). All goals are edited here; the
 * primary one (the first goal added) is deleted by choosing the goal that replaces it.
 */
export function GoalsCard({
  goals,
  kpis,
  hasSettings,
  currentMonth,
}: {
  goals: SavingsGoal[];
  /** Per-goal KPIs of the previewed plan, when it exists. */
  kpis: GoalKpis[] | null;
  hasSettings: boolean;
  currentMonth: YearMonth;
}) {
  const ordered = byPriority(goals);
  const [editing, setEditing] = useState<string | null>(null);
  /** Primary goal whose deletion waits for the choice of its successor. */
  const [replacing, setReplacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ key: string; errors: Errors } | null>(null);

  async function run(key: string, action: () => Promise<GoalActionResult>, after?: () => void) {
    setBusy(true);
    setNotice(null);
    setErrors(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setNotice(result.message);
      after?.();
    } else setErrors({ key, errors: result.errors });
  }

  const errorsFor = (key: string) => (errors?.key === key ? errors.errors : {});
  const kpiFor = (goal: SavingsGoal) => kpis?.find((k) => k.id === engineGoalId(goal));

  return (
    <section role="group" aria-labelledby="section-goals" className="flex flex-col gap-4 rounded-2xl border bg-card px-4 py-5 md:px-6">
      <div className="flex flex-col gap-1">
        <h2 id="section-goals" className="text-[17px] font-semibold">
          Objectifs d’épargne
        </h2>
        <p className="text-[13px] leading-snug text-muted-foreground">
          Remplis dans cet ordre, avant le fonds d’urgence ; chacun reçoit de l’épargne jusqu’à sa date limite (incluse).{" "}
          {MAX_GOALS} objectifs au plus. Le premier ajouté est l’objectif principal.
        </p>
      </div>

      {!hasSettings ? (
        <p className="text-sm text-muted-foreground">Enregistrez d’abord le budget pour ajouter des objectifs.</p>
      ) : (
        <ol className="flex flex-col">
          {ordered.map((goal, i) => {
            const kpi = kpiFor(goal);
            const key = `goal-${goal.id}`;
            return (
              <li key={goal.id} className="flex flex-col gap-2 border-b border-divider py-3 last:border-b-0">
                <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]">
                  <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-bucket-moving text-xs font-semibold text-on-bucket-moving">
                    {i + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="font-semibold break-words">
                      <span className="sr-only">Priorité {i + 1} : </span>
                      {goal.name}
                      {goal.primary ? <span className="ml-2 text-xs font-normal text-muted-foreground">principal</span> : null}
                    </h3>
                    <p className="text-[13px] text-muted-foreground tabular-nums">
                      {formatEuros(goal.target)} d’ici {formatMonthLong(goal.deadlineMonth)} · déjà {formatEuros(goal.alreadySaved)}
                    </p>
                    {kpi ? <GoalStatus kpi={kpi} /> : null}
                  </div>
                  <div className="col-start-2 flex shrink-0 gap-1 sm:col-start-auto">
                    <IconButton label={`Monter « ${goal.name} »`} disabled={busy || i === 0} onClick={() => void run(key, () => moveGoal(goal, goals, -1))}>
                      <ArrowUp aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Descendre « ${goal.name} »`}
                      disabled={busy || i === ordered.length - 1}
                      onClick={() => void run(key, () => moveGoal(goal, goals, 1))}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Modifier « ${goal.name} »`}
                      disabled={busy}
                      pressed={editing === goal.id}
                      onClick={() => setEditing(editing === goal.id ? null : goal.id)}
                    >
                      <Pencil aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      label={`Supprimer « ${goal.name} »`}
                      disabled={busy}
                      pressed={goal.primary && goals.length > 1 ? replacing === goal.id : undefined}
                      onClick={() =>
                        goal.primary && goals.length > 1
                          ? setReplacing(replacing === goal.id ? null : goal.id)
                          : void run(key, () => deleteGoal(goal, goals))
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </IconButton>
                  </div>
                </div>
                {replacing === goal.id ? (
                  <ReplacePrimary
                    idPrefix={key}
                    goal={goal}
                    candidates={ordered.filter((g) => g.id !== goal.id)}
                    busy={busy}
                    onCancel={() => setReplacing(null)}
                    onConfirm={(successor) => void run(key, () => deleteGoal(goal, goals, successor), () => setReplacing(null))}
                  />
                ) : null}
                {editing === goal.id ? (
                  <GoalFields
                    idPrefix={key}
                    title={`Modifier « ${goal.name} »`}
                    initial={{
                      name: goal.name,
                      target: amountInputValue(goal.target),
                      deadlineMonth: goal.deadlineMonth,
                      alreadySaved: amountInputValue(goal.alreadySaved),
                    }}
                    submitLabel="Enregistrer"
                    busy={busy}
                    errors={errorsFor(key)}
                    onCancel={() => setEditing(null)}
                    onSubmit={(form) => void run(key, () => updateGoal(goal, form, currentMonth), () => setEditing(null))}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {hasSettings && goals.length < MAX_GOALS ? (
        <GoalFields
          idPrefix="goal-new"
          title="Ajouter un objectif"
          initial={EMPTY}
          submitLabel="Ajouter l’objectif"
          busy={busy}
          errors={errorsFor("new")}
          resetOnSuccess={notice}
          onSubmit={(form) => void run("new", () => addGoal(form, goals, currentMonth))}
        />
      ) : null}

      <div aria-live="polite" className="empty:hidden">
        {notice ? (
          <p role="status" className="flex items-center gap-2 rounded-md border border-good-border bg-good-bg px-3 py-2 text-sm font-medium text-good">
            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {errors?.errors.form ? (
          <p role="alert" className="rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
            {errors.errors.form}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** « Atteint en … » or « Hors délai : il manquera … » (AC-07). */
function GoalStatus({ kpi }: { kpi: GoalKpis }) {
  if (kpi.met) {
    return (
      <p className="text-[13px] font-medium text-good">
        {kpi.reachedMonth ? `Atteint en ${formatMonthLong(kpi.reachedMonth)}` : "Atteint"}
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1 text-[13px] font-medium text-warning">
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      Hors délai : il manquera {formatEuros(kpi.target - kpi.amountAtDeadline)} fin {formatMonthLong(kpi.deadlineMonth)}
    </p>
  );
}

/** Deleting the primary goal: pick the goal that becomes primary (SPEC D23), then confirm. */
function ReplacePrimary({
  idPrefix,
  goal,
  candidates,
  busy,
  onCancel,
  onConfirm,
}: {
  idPrefix: string;
  goal: SavingsGoal;
  candidates: SavingsGoal[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (successor: SavingsGoal) => void;
}) {
  const [choice, setChoice] = useState(candidates[0]?.id ?? "");
  const selectId = `${idPrefix}-successor`;
  return (
    <div role="group" aria-label={`Supprimer l’objectif principal « ${goal.name} »`} className="flex flex-col gap-3 rounded-xl border border-divider p-3.5">
      <p className="text-sm">
        « {goal.name} » est l’objectif principal. Choisissez celui qui le remplace, puis confirmez la suppression.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={selectId}>Nouvel objectif principal</Label>
        <select
          id={selectId}
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="h-10.5 rounded-md border border-input bg-background px-3 text-sm"
        >
          {candidates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          className="min-h-11 md:min-h-9"
          onClick={() => {
            const successor = candidates.find((g) => g.id === choice);
            if (successor) onConfirm(successor);
          }}
        >
          Supprimer « {goal.name} »
        </Button>
        <Button type="button" variant="outline" disabled={busy} className="min-h-11 md:min-h-9" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "default" : "ghost"}
      size="icon"
      className="size-10 text-muted-foreground aria-pressed:text-primary-foreground"
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function GoalFields({
  idPrefix,
  title,
  initial,
  submitLabel,
  busy,
  errors,
  resetOnSuccess,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  title: string;
  initial: GoalForm;
  submitLabel: string;
  busy: boolean;
  errors: Errors;
  /** Changes after a successful add: the form is emptied. */
  resetOnSuccess?: string | null;
  onSubmit: (form: GoalForm) => void;
  onCancel?: () => void;
}) {
  const titleId = useId();
  const [resetKey, setResetKey] = useState(resetOnSuccess);
  const [formKey, setFormKey] = useState(0);
  if (resetOnSuccess !== resetKey) {
    setResetKey(resetOnSuccess);
    if (resetOnSuccess) setFormKey((k) => k + 1);
  }
  const field = (name: keyof GoalForm, label: string, props: { inputMode?: "decimal"; placeholder?: string } = {}) => {
    const id = `${idPrefix}-${name}`;
    const error = errors[name];
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          name={name}
          defaultValue={initial[name]}
          autoComplete="off"
          className={cn("h-10.5", props.inputMode === "decimal" && "text-right tabular-nums")}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
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
  };
  return (
    <form
      key={formKey}
      noValidate
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-divider p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(readForm(e));
      }}
    >
      <h3 id={titleId} className="text-sm font-semibold">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Nom de l’objectif", { placeholder: "Voiture, vacances, apport…" })}
        {field("target", "Montant visé (€)", { inputMode: "decimal" })}
        {field("deadlineMonth", "Date limite (AAAA-MM)", { placeholder: "AAAA-MM" })}
        {field("alreadySaved", "Déjà épargné (€)", { inputMode: "decimal" })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 md:min-h-9">
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={busy} className="min-h-11 md:min-h-9" onClick={onCancel}>
            Annuler
          </Button>
        ) : null}
      </div>
    </form>
  );
}
