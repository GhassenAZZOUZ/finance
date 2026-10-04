"use client";

import { useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, Plus, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { GAP_TONE, PLAN_GROUP } from "@/components/app/tones";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetCategory } from "@/lib/domain/types";
import { type YearMonth, compareMonths, simulatePlan } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatPercent } from "@/lib/format";
import { PlanLineChart } from "../_dashboard/plan-line-chart";
import {
  EXTRA_SOURCE_LABEL,
  type ExtraSource,
  type SimulationBase,
  type SimulationForm,
  type Tone,
  chartMonthCount,
  compareScenarios,
  firstNegativeFreeSavings,
  initialSimulation,
  planBounds,
  scenarioInput,
  scenarioSeries,
  scenarioSummary,
  updateSimulation,
} from "./logic";

const CATEGORY_TITLE: Record<BudgetCategory, string> = {
  income: "Revenus",
  fixed: "Charges fixes",
  variable: "Dépenses variables",
};

const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/**
 * "Et si…" simulator (issue #2). Everything stays in memory: this component never touches the
 * repository, and leaving the page or "Reprendre le plan actuel" discards the simulation.
 */
export function Simulator({ base, currentMonth }: { base: SimulationBase; currentMonth: YearMonth }) {
  const initial = useMemo(() => initialSimulation(base), [base]);
  const [state, setState] = useState(initial);
  const nextKey = useRef(1);

  const current = useMemo(() => simulatePlan(scenarioInput(base, initial.scenario)), [base, initial]);
  const simulated = useMemo(() => simulatePlan(scenarioInput(base, state.scenario)), [base, state.scenario]);
  const rows = compareScenarios(current.kpis, simulated.kpis);
  const pristine = JSON.stringify(state.scenario) === JSON.stringify(initial.scenario);
  const negativeFrom = firstNegativeFreeSavings(simulated);
  const count = chartMonthCount(current, simulated);
  const points = scenarioSeries(current, simulated, count);
  const hasErrors = Object.keys(state.errors).length > 0;

  const change = (update: (form: SimulationForm) => SimulationForm) =>
    setState((prev) => updateSimulation(prev, update(prev.form), base));
  const reset = () => setState(initialSimulation(base));

  const { first, last } = planBounds(base);
  const defaultMonth =
    compareMonths(currentMonth, first) < 0 ? first : compareMonths(currentMonth, last) > 0 ? last : currentMonth;
  const addExtra = () =>
    change((f) => ({
      ...f,
      extras: [
        ...f.extras,
        { key: `x${nextKey.current++}`, loanId: base.loans[0]?.id ?? "", month: defaultMonth, amount: "", source: "freeSavings" },
      ],
    }));

  const loanName = (id: string) => {
    const index = base.loans.findIndex((l) => l.id === id);
    const name = base.loans[index]?.name?.trim();
    return name || `Crédit ${index + 1}`;
  };

  return (
    <>
      <PageHeader
        title="Et si… ?"
        description="Testez des changements et comparez-les à votre plan. Rien n’est enregistré : vos données ne changent pas."
        actions={
          <Button type="button" variant="outline" className="min-h-10" onClick={reset} disabled={pristine && !hasErrors && state.form.extras.length === 0}>
            <RotateCcw aria-hidden />
            Reprendre le plan actuel
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Hypothèses</h2>
            </CardTitle>
            <CardDescription>Montants en euros, ex. 1 234,56. Chaque changement est recalculé tout de suite.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Field
                id="sim-early"
                label="Remboursement anticipé (% du reste)"
                value={state.form.earlyRepaymentPct}
                error={state.errors.earlyRepaymentPct}
                hint={`Plan actuel : ${formatPercent(base.settings.earlyRepaymentPct)}`}
                onChange={(v) => change((f) => ({ ...f, earlyRepaymentPct: v }))}
              />
              <Field
                id="sim-rate"
                label="Taux seuil (%)"
                value={state.form.riskFreeRate}
                error={state.errors.riskFreeRate}
                hint={`Plan actuel : ${formatPercent(base.settings.riskFreeRate)}. Seuls les crédits au TAEG supérieur reçoivent des remboursements anticipés.`}
                onChange={(v) => change((f) => ({ ...f, riskFreeRate: v }))}
              />
              <Field
                id="sim-inflation"
                label="Inflation des charges, par an (%)"
                value={state.form.expenseInflationRate}
                error={state.errors.expenseInflationRate}
                hint={`Plan actuel : ${formatPercent(base.settings.expenseInflationRate ?? 0)}. Appliquée chaque 1ᵉʳ janvier.`}
                onChange={(v) => change((f) => ({ ...f, expenseInflationRate: v }))}
              />
              <Field
                id="sim-growth"
                label="Évolution des revenus, par an (%)"
                value={state.form.incomeGrowthRate}
                error={state.errors.incomeGrowthRate}
                hint={`Plan actuel : ${formatPercent(base.settings.incomeGrowthRate ?? 0)}. Appliquée chaque 1ᵉʳ janvier.`}
                onChange={(v) => change((f) => ({ ...f, incomeGrowthRate: v }))}
              />
              <Field
                id="sim-emergency-rate"
                label="Taux d’intérêt du fonds d’urgence, par an (%)"
                value={state.form.emergencyRate}
                error={state.errors.emergencyRate}
                hint={`Plan actuel : ${formatPercent(base.settings.emergencyRate ?? 0)}. Intérêts versés chaque 31 décembre.`}
                onChange={(v) => change((f) => ({ ...f, emergencyRate: v }))}
              />
              <Field
                id="sim-free-rate"
                label="Taux d’intérêt de l’épargne libre, par an (%)"
                value={state.form.freeSavingsRate}
                error={state.errors.freeSavingsRate}
                hint={`Plan actuel : ${formatPercent(base.settings.freeSavingsRate ?? 0)}. Intérêts versés chaque 31 décembre.`}
                onChange={(v) => change((f) => ({ ...f, freeSavingsRate: v }))}
              />
            </div>

            <section aria-labelledby="sim-extras-title" className="flex flex-col gap-3 border-t pt-4">
              <div>
                <h3 id="sim-extras-title" className="text-sm font-semibold">
                  Remboursements exceptionnels
                </h3>
                <p className="text-sm text-muted-foreground">
                  Une somme versée en une fois sur un crédit, après la mensualité du mois.
                </p>
              </div>
              {state.form.extras.map((row, i) => {
                const id = `sim-extra-${row.key}`;
                const err = (name: string) => state.errors[`extra.${row.key}.${name}`];
                const legend = `Remboursement ${i + 1}`;
                return (
                  <fieldset key={row.key} className="flex flex-col gap-3 rounded-md border p-3">
                    <legend className="px-1 text-sm font-medium">{legend}</legend>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-loan`}>Crédit</Label>
                        <select
                          id={`${id}-loan`}
                          value={row.loanId}
                          onChange={(e) => change((f) => ({ ...f, extras: f.extras.map((x) => (x.key === row.key ? { ...x, loanId: e.target.value } : x)) }))}
                          aria-invalid={err("loanId") ? true : undefined}
                          aria-describedby={err("loanId") ? `${id}-loan-error` : undefined}
                          className={SELECT_CLASS}
                        >
                          {base.loans.map((l) => (
                            <option key={l.id} value={l.id}>
                              {loanName(l.id)}
                            </option>
                          ))}
                        </select>
                        <FieldError id={`${id}-loan-error`} error={err("loanId")} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-month`}>Mois</Label>
                        <Input
                          id={`${id}-month`}
                          type="month"
                          placeholder="AAAA-MM"
                          value={row.month}
                          onChange={(e) => change((f) => ({ ...f, extras: f.extras.map((x) => (x.key === row.key ? { ...x, month: e.target.value } : x)) }))}
                          className="h-10"
                          aria-invalid={err("month") ? true : undefined}
                          aria-describedby={err("month") ? `${id}-month-error` : undefined}
                        />
                        <FieldError id={`${id}-month-error`} error={err("month")} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`${id}-amount`}>
                          Montant <span className="text-muted-foreground">(€)</span>
                        </Label>
                        <Input
                          id={`${id}-amount`}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={row.amount}
                          onChange={(e) => change((f) => ({ ...f, extras: f.extras.map((x) => (x.key === row.key ? { ...x, amount: e.target.value } : x)) }))}
                          className="h-10 tabular-nums"
                          aria-invalid={err("amount") ? true : undefined}
                          aria-describedby={err("amount") ? `${id}-amount-error` : undefined}
                        />
                        <FieldError id={`${id}-amount-error`} error={err("amount")} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span id={`${id}-source-label`} className="text-sm leading-none font-medium">
                          Origine de l’argent
                        </span>
                        <div role="radiogroup" aria-labelledby={`${id}-source-label`} className="flex flex-col gap-1">
                          {(Object.keys(EXTRA_SOURCE_LABEL) as ExtraSource[]).map((source) => (
                            <label key={source} className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`${id}-source`}
                                value={source}
                                checked={row.source === source}
                                onChange={() => change((f) => ({ ...f, extras: f.extras.map((x) => (x.key === row.key ? { ...x, source } : x)) }))}
                                className="size-4"
                              />
                              {EXTRA_SOURCE_LABEL[source]}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10 self-start"
                      aria-label={`Retirer le ${legend.toLowerCase()}`}
                      onClick={() => change((f) => ({ ...f, extras: f.extras.filter((x) => x.key !== row.key) }))}
                    >
                      <Trash2 aria-hidden />
                      Retirer
                    </Button>
                  </fieldset>
                );
              })}
              {base.loans.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun crédit actif.</p>
              ) : (
                <Button type="button" variant="outline" className="min-h-10 self-start" onClick={addExtra}>
                  <Plus aria-hidden />
                  Ajouter un remboursement
                </Button>
              )}
            </section>

            {base.lines.length > 0 ? (
              <details className="border-t pt-4">
                <summary className="w-fit cursor-pointer rounded-sm text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  Montants du budget ({base.lines.length} lignes)
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  {(Object.keys(CATEGORY_TITLE) as BudgetCategory[]).map((category) => {
                    const lines = base.lines.filter((l) => l.category === category);
                    if (lines.length === 0) return null;
                    return (
                      <fieldset key={category} className="flex flex-col gap-3">
                        <legend className="mb-2 text-sm font-medium text-muted-foreground">{CATEGORY_TITLE[category]}</legend>
                        {lines.map((line) => (
                          <Field
                            key={line.id}
                            id={`sim-line-${line.id}`}
                            label={line.label || "Sans libellé"}
                            suffix="€ / mois"
                            value={state.form.lineAmounts[line.id] ?? ""}
                            error={state.errors[`line.${line.id}`]}
                            hint={`Plan actuel : ${formatEuros(line.amount)}${periodText(line.startMonth, line.endMonth)}`}
                            onChange={(v) => change((f) => ({ ...f, lineAmounts: { ...f.lineAmounts, [line.id]: v } }))}
                          />
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Plan actuel et simulation</h2>
            </CardTitle>
            <CardDescription>Intérêts nets des IRA saisies sur vos crédits (indemnités de remboursement anticipé).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
              {hasErrors ? (
                <p className="flex items-start gap-2 rounded-md border border-bad-border bg-bad-bg px-3 py-2 text-sm text-bad">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  Certaines valeurs sont invalides : la simulation garde les dernières valeurs valides.
                </p>
              ) : null}
              {pristine ? (
                <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                  La simulation est identique à votre plan. Modifiez une hypothèse pour comparer.
                </p>
              ) : null}
            </div>
            {negativeFrom ? (
              <Alert className="border-warning-border bg-warning-bg px-4 py-3 text-warning">
                <CircleAlert aria-hidden />
                <AlertTitle>Épargne libre négative dès {formatMonthLong(negativeFrom)}</AlertTitle>
                <AlertDescription className="text-warning">
                  Le montant prélevé dépasse ce que vous aurez mis de côté en épargne libre à ce moment-là.
                </AlertDescription>
              </Alert>
            ) : null}
            {/* Phones: one block per indicator, so the difference is never scrolled out of view. */}
            <ul className="flex flex-col divide-y sm:hidden" aria-label="Comparaison entre le plan actuel et la simulation">
              {rows.map((row) => (
                <li key={row.key} className="py-2 text-sm first:pt-0 last:pb-0">
                  <p className="font-medium">{row.label}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <dt className="text-muted-foreground">Plan actuel</dt>
                    <dd className="tabular-nums">{row.current}</dd>
                    <dt className="text-muted-foreground">Simulation</dt>
                    <dd className="font-medium tabular-nums">{row.simulated}</dd>
                    <dt className="text-muted-foreground">Écart</dt>
                    <dd className="tabular-nums">
                      <Difference text={row.difference} tone={row.tone} />
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Comparaison entre le plan actuel et la simulation</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Indicateur
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Plan actuel
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Simulation
                    </th>
                    <th scope="col" className="py-2 pl-3 font-medium">
                      Écart
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-b last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {row.label}
                      </th>
                      <td className="px-3 py-2 tabular-nums">{row.current}</td>
                      <td className="px-3 py-2 font-medium tabular-nums">{row.simulated}</td>
                      <td className="py-2 pl-3 tabular-nums">
                        <Difference text={row.difference} tone={row.tone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Évolution sur {count} mois</h2>
          </CardTitle>
          <CardDescription>Plan actuel en trait plein, simulation en pointillés.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="sim-debt-title" className="flex flex-col gap-2">
            <h3 id="sim-debt-title" className="text-sm font-medium">
              Dette restante
            </h3>
            <PlanLineChart
              data={points}
              summary={scenarioSummary(current, simulated, count, "debt")}
              tableCaption="Dette restante, plan actuel et simulation, par mois"
              series={[
                { key: "currentDebt", name: "Plan actuel", color: PLAN_GROUP.debts.stroke },
                { key: "simulatedDebt", name: "Simulation", color: PLAN_GROUP.debts.stroke, dashed: true },
              ]}
            />
          </section>
          <section aria-labelledby="sim-savings-title" className="flex flex-col gap-2">
            <h3 id="sim-savings-title" className="text-sm font-medium">
              Épargne libre cumulée
            </h3>
            <PlanLineChart
              data={points}
              summary={scenarioSummary(current, simulated, count, "freeSavings")}
              tableCaption="Épargne libre cumulée, plan actuel et simulation, par mois"
              series={[
                { key: "currentFreeSavings", name: "Plan actuel", color: PLAN_GROUP.remainder.stroke },
                { key: "simulatedFreeSavings", name: "Simulation", color: PLAN_GROUP.remainder.stroke, dashed: true },
              ]}
            />
          </section>
        </CardContent>
      </Card>
    </>
  );
}

function periodText(start: YearMonth | null, end: YearMonth | null): string {
  if (start && end) return `, de ${formatMonthLong(start)} à ${formatMonthLong(end)}`;
  if (start) return `, à partir de ${formatMonthLong(start)}`;
  if (end) return `, jusqu’à ${formatMonthLong(end)}`;
  return "";
}

function Difference({ text, tone }: { text: string; tone: Tone | null }) {
  if (!tone) return <span className="text-muted-foreground">{text}</span>;
  const Icon = tone === "good" ? CircleCheck : CircleAlert;
  return (
    <span className={`inline-flex items-center gap-1 ${GAP_TONE[tone]}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {text}
      <span className="sr-only">{tone === "good" ? "(mieux)" : "(moins bien)"}</span>
    </span>
  );
}

function Field({
  id,
  label,
  suffix,
  value,
  error,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  suffix?: string;
  value: string;
  error?: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {suffix ? <span className="text-muted-foreground"> ({suffix})</span> : null}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 tabular-nums"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-bad">
      {error}
    </p>
  );
}
