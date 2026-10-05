"use client";

/**
 * Mobile check-in (< md, issue #110; docs/design/MOBILE.md §2, mockup MobileSaisie.dc.html): a
 * full-screen flow in 4 steps (owner decision 2026-10-05: the per-line amounts of #72 come first).
 * One form with the same field names and the same action as the desktop form: the steps only show
 * one part at a time, every input stays in the form, and it is submitted once, from the last step.
 */
import { ArrowLeft, ArrowRight, Check, CheckCircle2, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/app/status-badge";
import { VerdictBadge, VerdictDetail } from "@/components/app/verdict-badge";
import { Button } from "@/components/ui/button";
import type { CheckInRow } from "@/lib/domain/actual-lines";
import { type ActualForm, parseAmount, parseDeposit } from "@/lib/domain/validation";
import { type Cents, type YearMonth, GAP_TOLERANCE, addMonths } from "@/lib/engine";
import { amountInputValue, formatEuros, formatMonthLong } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type SaveActualState, saveActualAction } from "./actions";
import { BankImport } from "./bank-import";
import { type CheckInFormProps, SAVINGS_FIELDS, depositInputValue, goalFieldLabel, liveVerdict } from "./check-in-form";
import { type PlannedValues, applyLineTotals, provisionalCheck } from "./logic";

type StepId = "rows" | "savings" | "loans" | "review";

const STEPS: { id: StepId; label: string; next: string }[] = [
  { id: "rows", label: "Revenus et dépenses", next: "épargne" },
  { id: "savings", label: "Épargne", next: "crédits" },
  { id: "loans", label: "Crédits", next: "vérifier" },
  { id: "review", label: "Vérifier", next: "" },
];

/** savings / income must not fall short; debts / expenses must not exceed (±10 €, §8.2). */
type Rule = "savings" | "income" | "debt" | "expense";


/** « ✓ conforme au plan », « ↓ 100,00 € sous le plan », « ↑ 20,00 € au-dessus du plan ». */
export function gapLine(typed: Cents | null, planned: Cents | null, rule: Rule): { text: string; good: boolean } | null {
  if (typed === null || planned === null) return null;
  const gap = typed - planned;
  if (Math.abs(gap) <= GAP_TOLERANCE) return { text: "✓ conforme au plan", good: true };
  const above = gap > 0;
  const good = rule === "savings" || rule === "income" ? above : !above;
  return { text: above ? `↑ ${formatEuros(gap)} au-dessus du plan` : `↓ ${formatEuros(-gap)} sous le plan`, good };
}

/** Which step a field name belongs to (to show a save error on its step). */
function stepOf(field: string): StepId {
  if (field.startsWith("line.")) return "rows";
  if (field.startsWith("loan.")) return "loans";
  if (field.startsWith("goal.") || field === "emergencySavings" || field === "freeSavings") return "savings";
  return "review";
}

export type MobileCheckInProps = Pick<
  CheckInFormProps,
  "values" | "existing" | "earlyMonth" | "budgetLines" | "bankCsvMapping" | "bankRules" | "planned" | "rows" | "loans" | "goals"
> & { month: YearMonth };

export function MobileCheckIn({
  month,
  values,
  existing,
  earlyMonth = null,
  budgetLines = [],
  bankCsvMapping = null,
  bankRules = [],
  planned,
  rows = {},
  loans,
  goals = [],
}: MobileCheckInProps) {
  const router = useRouter();
  const [step, setStep] = useState<StepId>("rows");
  // Same action as desktop; a refused save opens the step of its first field error.
  const [state, action, pending] = useActionState<SaveActualState, FormData>(async (prev, formData) => {
    const result = await saveActualAction(prev, formData);
    const first = result.status === "error" ? Object.keys(result.errors)[0] : undefined;
    if (first) setStep(stepOf(first));
    return result;
  }, { status: "idle" });
  const [form, setForm] = useState<ActualForm>(() => values[month]!);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);

  const plan: PlannedValues | null = planned[month] ?? null;
  const monthRows = rows[month] ?? [];
  const early = month === earlyMonth;
  const previous = addMonths(month, -1);
  const previousValues = existing.includes(previous) ? values[previous] : undefined;
  const serverErrors = state.status === "error" ? state.errors : {};
  const errors = { ...serverErrors, ...stepErrors };
  const index = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  const close = () => (window.history.length > 1 ? router.back() : router.replace("/suivi"));

  const lineValue = (key: string) => form.lines?.find((l) => l.key === key)?.actual ?? "";
  const setLine = (key: string, value: string) =>
    setForm((f) => ({ ...f, lines: (f.lines ?? []).map((l) => (l.key === key ? { ...l, actual: value } : l)) }));
  const goalValue = (goalId: string) => form.goalBalances?.find((b) => b.goalId === goalId)?.balance ?? "";
  const setGoal = (goalId: string, value: string) =>
    setForm((f) => ({ ...f, goalBalances: (f.goalBalances ?? []).map((b) => (b.goalId === goalId ? { ...b, balance: value } : b)) }));
  const loanValue = (loanId: string) => form.loanBalances.find((b) => b.loanId === loanId)?.balance ?? "";
  const setLoan = (loanId: string, value: string) =>
    setForm((f) => ({ ...f, loanBalances: f.loanBalances.map((b) => (b.loanId === loanId ? { ...b, balance: value } : b)) }));

  const deposits = plan?.deposits ?? null;
  /** The savings fields of the month: deposits (D33) when the plan has them, else balances. */
  const savingsFields = [
    ...goals.map((g, j) => ({
      key: `goal.${g.id}`,
      label: goalFieldLabel(g.label),
      value: goalValue(g.id),
      set: (v: string) => setGoal(g.id, v),
      planned: deposits ? (deposits.goals[j] ?? 0) : (plan?.goalBalances[j] ?? null),
      previous: previousValues?.goalBalances?.find((b) => b.goalId === g.id)?.balance,
    })),
    ...SAVINGS_FIELDS.map((f) => ({
      key: f.name,
      label: f.label,
      value: form[f.name],
      set: (v: string) => setForm((x) => ({ ...x, [f.name]: v })),
      planned: deposits ? (f.name === "emergencySavings" ? deposits.emergency : deposits.free) : plan ? plan[f.name] : null,
      previous: previousValues?.[f.name],
    })),
  ];
  const asInput = (cents: Cents) => (deposits ? depositInputValue(cents) : amountInputValue(cents));
  const parseSavings = (raw: string) => (deposits ? parseDeposit(raw) : parseAmount(raw));

  /** « Tout est comme prévu »: the planned values into the step's empty fields (like desktop). */
  function fillStep() {
    if (step === "rows") {
      setForm((f) => ({
        ...f,
        lines: (f.lines ?? []).map((l) => {
          const row = monthRows.find((r) => r.key === l.key);
          return row && l.actual.trim() === "" ? { ...l, actual: amountInputValue(row.planned) } : l;
        }),
      }));
    } else if (step === "savings") {
      for (const field of savingsFields) if (field.value.trim() === "" && field.planned !== null) field.set(asInput(field.planned));
    } else if (step === "loans" && plan) {
      setForm((f) => ({
        ...f,
        loanBalances: f.loanBalances.map((b) => {
          const j = loans.findIndex((l) => l.id === b.loanId);
          return b.balance.trim() === "" && j >= 0 ? { ...b, balance: amountInputValue(plan.loanBalances[j] ?? 0) } : b;
        }),
      }));
    }
  }

  /** Invalid amounts of the step block « Suivant »; empty ones are left for the final check. */
  function validateStep(): boolean {
    const found: Record<string, string> = {};
    const check = (key: string, raw: string, parse: (raw: string) => { ok: boolean; error?: string }) => {
      if (raw.trim() === "") return;
      const parsed = parse(raw);
      if (!parsed.ok) found[key] = parsed.error ?? "Montant invalide";
    };
    if (step === "rows") for (const row of monthRows) check(`line.${row.key}`, lineValue(row.key), parseAmount);
    if (step === "savings") for (const f of savingsFields) check(f.key, f.value, parseSavings);
    if (step === "loans" && !early) for (const loan of loans) check(`loan.${loan.id}`, loanValue(loan.id), parseAmount);
    setStepErrors(found);
    return Object.keys(found).length === 0;
  }

  const go = (to: number) => setStep(STEPS[Math.max(0, Math.min(STEPS.length - 1, to))]!.id);
  const live = liveVerdict(form, monthRows, plan, goals);
  const check = provisionalCheck(form, plan);
  const saved = state.status === "saved";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
      <header className="flex items-center gap-3 border-b px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <button
          type="button"
          onClick={close}
          aria-label="Fermer la saisie"
          className="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-5.5" />
        </button>
        <span className="text-[15px] font-semibold">Suivi · {formatMonthLong(month)}</span>
      </header>
      <div
        role="progressbar"
        aria-label="Progression de la saisie"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={index + 1}
        aria-valuetext={`Étape ${index + 1} sur ${STEPS.length} : ${STEPS[index]!.label}`}
        className="flex gap-1 px-4 pt-3"
      >
        {STEPS.map((s, i) => (
          <span key={s.id} className={cn("h-1 grow rounded-full", i <= index ? "bg-foreground" : "bg-secondary")} />
        ))}
      </div>

      <form action={action} noValidate className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="month" value={month} />
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          {existing.includes(month) ? (
            <p className="mb-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
              Déjà saisi — la modification remplacera la saisie
            </p>
          ) : null}

          {/* Every step stays in the form (hidden ones too): one submit carries all the fields. */}
          <section hidden={step !== "rows"} aria-labelledby="m-rows-title" className="flex flex-col gap-3">
            <StepTitle id="m-rows-title" titleRef={step === "rows" ? titleRef : undefined}>
              Revenus et dépenses de {monthName(month)}
            </StepTitle>
            <p className="text-sm text-muted-foreground">Ce que vous avez reçu et dépensé, ligne par ligne, hors crédits et épargne.</p>
            {budgetLines.length > 0 ? (
              <BankImport
                month={month}
                lines={budgetLines}
                savedMapping={bankCsvMapping}
                rules={bankRules}
                onApply={(totals) => setForm((f) => ({ ...f, lines: applyLineTotals(f.lines ?? [], monthRows, totals) }))}
              />
            ) : null}
            <AllAsPlanned onClick={fillStep} />
            {monthRows.length === 0 ? <p className="text-sm text-muted-foreground">Aucune ligne de budget ce mois-ci.</p> : null}
            {monthRows.map((row: CheckInRow) => (
              <FieldCard
                key={row.key}
                id={`m-line-${row.key}`}
                name={`line.${row.key}`}
                label={row.label}
                value={lineValue(row.key)}
                onChange={(v) => setLine(row.key, v)}
                planned={row.planned}
                previous={previousValues?.lines?.find((l) => l.key === row.key)?.actual}
                previousMonth={previous}
                asInput={amountInputValue}
                parse={parseAmount}
                rule={row.direction}
                error={errors[`line.${row.key}`]}
              />
            ))}
          </section>

          <section hidden={step !== "savings"} aria-labelledby="m-savings-title" className="flex flex-col gap-3">
            <StepTitle id="m-savings-title" titleRef={step === "savings" ? titleRef : undefined}>
              {deposits ? `Combien avez-vous versé en ${monthName(month)} ?` : `Votre épargne fin ${monthName(month)}`}
            </StepTitle>
            <p className="text-sm text-muted-foreground">
              {deposits
                ? "Ce que vous avez mis sur chaque épargne ce mois-ci (un retrait se saisit en négatif, ex. −200)."
                : "Le solde de chaque épargne en fin de mois."}
            </p>
            <AllAsPlanned onClick={fillStep} />
            {savingsFields.map((f) => (
              <FieldCard
                key={f.key}
                id={`m-${f.key.replace(".", "-")}`}
                name={f.key}
                label={f.label}
                value={f.value}
                onChange={f.set}
                planned={f.planned}
                previous={f.previous}
                previousMonth={previous}
                asInput={asInput}
                parse={parseSavings}
                rule="savings"
                error={errors[f.key]}
              />
            ))}
          </section>

          <section hidden={step !== "loans"} aria-labelledby="m-loans-title" className="flex flex-col gap-3">
            <StepTitle id="m-loans-title" titleRef={step === "loans" ? titleRef : undefined}>
              Capital restant dû
            </StepTitle>
            {loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun crédit actif : rien à saisir.</p>
            ) : early ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Mois ouvert en avance : les soldes sont repris du plan, rien à saisir.
                </p>
                {loans.map((loan, j) => (
                  <div key={loan.id} className="flex items-center justify-between rounded-[18px] border bg-card px-4 py-3.5 text-sm">
                    <span className="font-medium">{loan.label}</span>
                    <span className="tabular-nums">{plan ? formatEuros(plan.loanBalances[j] ?? 0) : "—"}</span>
                    {/* Same payload as desktop: the plan's balances, read-only. */}
                    <input type="hidden" name={`loan.${loan.id}`} value={loanValue(loan.id)} />
                  </div>
                ))}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Le capital restant dû indiqué sur vos relevés de crédit.</p>
                <AllAsPlanned onClick={fillStep} />
                {loans.map((loan, j) => (
                  <FieldCard
                    key={loan.id}
                    id={`m-loan-${loan.id}`}
                    name={`loan.${loan.id}`}
                    label={loan.label}
                    value={loanValue(loan.id)}
                    onChange={(v) => setLoan(loan.id, v)}
                    planned={plan?.loanBalances[j] ?? null}
                    previous={previousValues?.loanBalances.find((b) => b.loanId === loan.id)?.balance}
                    previousMonth={previous}
                    asInput={amountInputValue}
                    parse={parseAmount}
                    rule="debt"
                    error={errors[`loan.${loan.id}`]}
                  />
                ))}
              </>
            )}
          </section>

          <section hidden={step !== "review"} aria-labelledby="m-review-title" className="flex flex-col gap-4">
            <StepTitle id="m-review-title" titleRef={step === "review" ? titleRef : undefined}>
              Vérifier {monthName(month)}
            </StepTitle>
            {live !== undefined ? (
              <div className="flex flex-col gap-1.5 rounded-[18px] border bg-card p-4">
                <span className="text-[13px] font-medium text-muted-foreground">Verdict du mois</span>
                <VerdictBadge verdict={live} pending="incomplet : remplissez chaque ligne et chaque épargne" />
                {live ? <VerdictDetail verdict={live} /> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5 rounded-[18px] border bg-card p-4 text-sm">
              <span className="text-[13px] font-medium text-muted-foreground">Trajectoire provisoire</span>
              <span className="flex flex-wrap items-center gap-2">
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
            <div aria-live="polite" className="empty:hidden">
              {saved ? (
                <div role="status" className="flex flex-col gap-3 rounded-xl border border-good-border bg-good-bg px-4 py-3 text-sm text-good">
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2 aria-hidden className="size-4 shrink-0" />
                    Mois de {formatMonthLong(month)} enregistré.
                  </p>
                  <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => router.replace("/suivi")}>
                    Terminer
                  </Button>
                </div>
              ) : null}
              {state.status === "error" ? (
                <p role="alert" className="flex items-center gap-2 rounded-xl border border-bad-border bg-bad-bg px-4 py-3 text-sm font-medium text-bad">
                  <TriangleAlert aria-hidden className="size-4 shrink-0" />
                  {state.message}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {index + 1} sur {STEPS.length}
          </span>
          {index > 0 ? (
            <Button type="button" variant="outline" className="min-h-13" onClick={() => go(index - 1)} aria-label="Précédent">
              <ArrowLeft aria-hidden />
            </Button>
          ) : null}
          {/* Distinct keys: reusing the "Suivant" node as the submit button would submit the form on that click. */}
          {step === "review" ? (
            <Button key="save" type="submit" disabled={pending || saved} className="min-h-13 grow text-[15px]">
              {pending ? "Enregistrement…" : `Enregistrer ${formatMonthLong(month)}`}
            </Button>
          ) : (
            <Button key="next" type="button" className="min-h-13 grow text-[15px]" onClick={() => (validateStep() ? go(index + 1) : undefined)}>
              Suivant : {STEPS[index]!.next}
              <ArrowRight aria-hidden />
            </Button>
          )}
        </footer>
      </form>
    </div>
  );
}

const monthName = (month: YearMonth) => formatMonthLong(month).replace(/ \d{4}$/, "");

function signed(cents: Cents): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

function StepTitle({ id, titleRef, children }: { id: string; titleRef?: React.Ref<HTMLHeadingElement>; children: React.ReactNode }) {
  return (
    <h2 id={id} ref={titleRef} tabIndex={-1} className="font-heading text-[26px] leading-tight font-medium outline-none">
      {children}
    </h2>
  );
}

function AllAsPlanned({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" className="min-h-11 self-start" onClick={onClick}>
      <Check aria-hidden />
      Tout est comme prévu
    </Button>
  );
}

/** One field: label, « prévu X € », a large input, chips « = prévu » / « Même qu’en … », the live gap line. */
function FieldCard({
  id,
  name,
  label,
  value,
  onChange,
  planned,
  previous,
  previousMonth,
  asInput,
  parse,
  rule,
  error,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  planned: Cents | null;
  previous: string | undefined;
  previousMonth: YearMonth;
  asInput: (cents: Cents) => string;
  parse: (raw: string) => { ok: true; value: Cents | null } | { ok: false; error: string };
  rule: Rule;
  error?: string;
}) {
  const parsed = value.trim() === "" ? null : parse(value);
  const typed = parsed && parsed.ok ? parsed.value : null;
  const gap = gapLine(typed, planned, rule);
  const chip =
    "min-h-9 rounded-full border px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className="flex flex-col gap-2 rounded-[18px] border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[15px] font-semibold">
          {label}
        </label>
        {planned !== null ? <span className="text-[13px] text-muted-foreground tabular-nums">prévu {formatEuros(planned)}</span> : null}
      </div>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : gap ? `${id}-gap` : undefined}
        className="h-14 w-full rounded-xl border border-input bg-background px-3.5 text-[22px] tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      <div className="flex flex-wrap gap-2">
        {planned !== null ? (
          <button type="button" className={chip} onClick={() => onChange(asInput(planned))} aria-label={`Comme prévu : ${label}`}>
            = prévu
          </button>
        ) : null}
        {previous && previous.trim() !== "" ? (
          <button type="button" className={chip} onClick={() => onChange(previous)} aria-label={`Même qu’en ${monthName(previousMonth)} : ${label}`}>
            Même qu’en {monthName(previousMonth)}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad">
          {error}
        </p>
      ) : gap ? (
        <p id={`${id}-gap`} className={cn("text-sm font-medium", gap.good ? "text-good" : "text-bad")}>
          {gap.text}
        </p>
      ) : null}
    </div>
  );
}

