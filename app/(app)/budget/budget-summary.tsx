import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { Cents } from "@/lib/engine";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DEBT_ALERT_LABEL, debtFreeText, emergencyReachedText } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { type BudgetPreview, type ParamField } from "./budget-form-state";

export const PARAM_LABEL: Record<ParamField, string> = {
  startMonth: "Début du plan",
  movingGoal: "Objectif déménagement",
  movingDeadlineMonth: "Date limite déménagement",
  movingAlreadySaved: "Déjà épargné (déménagement)",
  emergencyTarget: "Objectif fonds d’urgence",
  emergencyExisting: "Fonds d’urgence existant",
  freeSavingsExisting: "Épargne libre existante",
  riskFreeRate: "Taux seuil",
  earlyRepaymentPct: "Part du reste en remboursement anticipé",
};

const NEGATIVE = "font-semibold text-bad";

/** One cascade step: label, amount, and a bar placed after the previous steps (decorative). */
function Step({
  label,
  children,
  bar,
  className,
  emphasis = false,
}: {
  label: string;
  children: ReactNode;
  bar?: { offset: number; width: number; className: string };
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1", emphasis && "border-t border-divider pt-2.5")}>
      <dt className={emphasis ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("text-right tabular-nums", className ?? "font-medium")}>{children}</dd>
      {bar ? (
        <div aria-hidden className="col-span-2 h-1.5">
          <div
            className={cn("h-full rounded-[3px]", bar.className)}
            style={{ marginLeft: `${Math.min(1, bar.offset) * 100}%`, width: `${Math.max(0, Math.min(1 - bar.offset, bar.width)) * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Result({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", className ?? "font-medium")}>{children}</dd>
    </div>
  );
}

/** Live summary of the form (SPEC §7 KPIs), recomputed client-side on every change. */
export function BudgetSummary({
  preview,
  dirty,
  missingParams,
  footer,
}: {
  preview: BudgetPreview;
  dirty: boolean;
  missingParams: ParamField[];
  footer: ReactNode;
}) {
  const k = preview.plan?.kpis;
  const firstMonth = preview.plan?.months[0];
  const month = preview.referenceMonth;
  // The regular-month figures describe the reference month (SPEC D15).
  const monthTag = month ? formatMonthShort(month) : "mois normal";
  const income = preview.income;
  const share = (cents: Cents) => (income > 0 ? Math.max(0, cents) / income : 0);
  const fixed = share(preview.fixed);
  const variable = share(preview.variable);
  const payments = share(preview.loanPayments);
  const shortfall = k && !k.movingGoalMet ? k.movingGoal - k.movingAmountAtDeadline : 0;
  return (
    <div className="flex flex-col gap-4.5 rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="apercu-titre" className="font-heading text-2xl font-medium">
          {dirty ? "Aperçu (non enregistré)" : "Aperçu"}
        </h2>
        {month ? <span className="text-[13px] text-muted-foreground">{formatMonthShort(month)}</span> : null}
      </div>
      {month ? (
        <p className="sr-only">
          Mois de référence : {formatMonthLong(month)}
        </p>
      ) : null}
      <dl className="flex flex-col gap-2.5 text-sm">
        <Step label="Revenus" bar={income > 0 ? { offset: 0, width: 1, className: "bg-good" } : undefined}>
          {formatEuros(preview.income)}
        </Step>
        <Step label="Charges fixes" bar={{ offset: 0, width: fixed, className: "bg-bucket-fixed" }}>
          {formatEuros(preview.fixed)}
        </Step>
        <Step label="Dépenses variables" bar={{ offset: fixed, width: variable, className: "bg-bucket-expenses" }}>
          {formatEuros(preview.variable)}
        </Step>
        <Step label="Mensualités de crédit" bar={{ offset: fixed + variable, width: payments, className: "bg-bucket-payments-strong" }}>
          {formatEuros(preview.loanPayments)}
        </Step>
        <Step
          label={`Marge mensuelle (${monthTag})`}
          emphasis
          className={preview.margin < 0 ? NEGATIVE : "text-lg font-semibold"}
          bar={
            preview.margin > 0
              ? { offset: fixed + variable + payments, width: share(preview.margin), className: "bg-bucket-moving" }
              : undefined
          }
        >
          {preview.margin < 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle aria-hidden className="size-4" />
              {formatEuros(preview.margin)} (négative)
            </span>
          ) : (
            formatEuros(preview.margin)
          )}
        </Step>
        <Result
          label="Taux d’endettement"
          className={cn(
            "font-medium tabular-nums",
            preview.debtRatio === null ? undefined : preview.debtAlert === "ok" ? "text-good" : preview.debtAlert === "warning" ? "text-warning" : "text-bad",
          )}
        >
          {preview.debtRatio === null ? "—" : `${formatPercent(preview.debtRatio, 1)} · ${DEBT_ALERT_LABEL[preview.debtAlert]}`}
        </Result>
      </dl>
      {preview.hasPeriods ? (
        <p className="text-[13px] text-muted-foreground">
          Certaines lignes changent au fil du temps : le plan en tient compte mois par mois.
        </p>
      ) : null}
      {preview.exceptionMonths > 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Exceptions : {preview.exceptionMonths} mois concerné{preview.exceptionMonths > 1 ? "s" : ""}. Les montants
          ci-dessus décrivent {month ? `${formatMonthShort(month)} hors exceptions` : "un mois normal"} ; le plan
          ci-dessous inclut les exceptions.
        </p>
      ) : null}
      {preview.invalidAmounts > 0 ? (
        <p className="text-[13px] text-warning">
          {preview.invalidAmounts === 1
            ? "1 montant invalide est ignoré dans les totaux."
            : `${preview.invalidAmounts} montants invalides sont ignorés dans les totaux.`}
        </p>
      ) : null}
      <div className="flex flex-col gap-2.5 border-t border-divider pt-4 text-sm">
        <h3 className="text-[13px] font-medium tracking-[0.02em] text-muted-foreground">Résultat du plan</h3>
        {k && firstMonth ? (
          <dl className="flex flex-col gap-2.5">
            <Result label="Disponible le 1er mois" className={cn("tabular-nums", firstMonth.available < 0 ? NEGATIVE : "font-medium")}>
              {formatEuros(firstMonth.available)}
            </Result>
            <Result label="Épargne déménagement / mois" className="font-medium tabular-nums">
              {k.deadlineBeforeStart ? "Date limite dépassée" : formatEuros(k.movingMonthlyNeeded)}
            </Result>
            <Result label="Déménagement" className={k.movingGoalMet ? "font-semibold text-good" : NEGATIVE}>
              {k.movingGoal === 0
                ? "Aucun objectif"
                : k.movingGoalMet
                  ? `✓ Tenu${k.movingReachedMonth ? ` · ${formatMonthShort(k.movingReachedMonth)}` : ""}`
                  : `✗ Non tenu · −${formatEuros(shortfall)}`}
            </Result>
            <Result label="Fonds d’urgence">{emergencyReachedText(k)}</Result>
            <Result label="Fin des dettes">{debtFreeText(k)}</Result>
            <Result label="Mois en budget négatif" className={k.negativeBudgetMonths > 0 ? NEGATIVE : "font-medium text-good"}>
              {k.negativeBudgetMonths > 0 ? `${k.negativeBudgetMonths} (à corriger)` : "0"}
            </Result>
          </dl>
        ) : (
          <div>
            <p className="font-medium">Plan indisponible : paramètres incomplets ou invalides.</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {missingParams.map((f) => (
                <li key={f}>{PARAM_LABEL[f]}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {footer}
    </div>
  );
}
