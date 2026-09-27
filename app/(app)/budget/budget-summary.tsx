import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatEuros, formatMonthLong, formatMonthShort, formatPercent } from "@/lib/format";
import { DEBT_ALERT_LABEL, debtFreeText, emergencyReachedText, movingReachedText, movingStatusText } from "@/lib/labels";
import { type BudgetPreview, type ParamField } from "./budget-form-state";

export const PARAM_LABEL: Record<ParamField, string> = {
  startMonth: "Mois de début",
  movingGoal: "Objectif déménagement",
  movingDeadlineMonth: "Date limite déménagement",
  movingAlreadySaved: "Déjà épargné (déménagement)",
  emergencyTarget: "Objectif fonds d’urgence",
  emergencyExisting: "Fonds d’urgence existant",
  riskFreeRate: "Taux seuil",
  earlyRepaymentPct: "Part du reste en remboursement anticipé",
};

const NEGATIVE = "font-semibold text-red-700";

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right tabular-nums ${className ?? "font-medium"}`}>{children}</dd>
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
  return (
    <Card>
      <CardHeader>
        <CardTitle id="apercu-titre" role="heading" aria-level={2}>
          {dirty ? "Aperçu (non enregistré)" : "Aperçu"}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {month ? (
          <p className="text-muted-foreground">
            Mois de référence : <span className="font-medium text-foreground">{formatMonthLong(month)}</span>
          </p>
        ) : null}
        <dl>
          <Row label="Revenus">{formatEuros(preview.income)}</Row>
          <Row label="Charges fixes">{formatEuros(preview.fixed)}</Row>
          <Row label="Dépenses variables">{formatEuros(preview.variable)}</Row>
          <Row label="Mensualités de crédit">{formatEuros(preview.loanPayments)}</Row>
          <Row label={`Marge mensuelle (${monthTag})`} className={preview.margin < 0 ? NEGATIVE : "font-semibold"}>
            {preview.margin < 0 ? (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle aria-hidden className="size-4" />
                {formatEuros(preview.margin)} (négative)
              </span>
            ) : (
              formatEuros(preview.margin)
            )}
          </Row>
          <Row label="Taux d’endettement">
            {preview.debtRatio === null ? "—" : `${formatPercent(preview.debtRatio, 1)} · ${DEBT_ALERT_LABEL[preview.debtAlert]}`}
          </Row>
        </dl>
        {preview.hasPeriods ? (
          <p className="text-muted-foreground">
            Certaines lignes changent au fil du temps : le plan en tient compte mois par mois.
          </p>
        ) : null}
        {preview.exceptionMonths > 0 ? (
          <p className="text-muted-foreground">
            Exceptions : {preview.exceptionMonths} mois concerné{preview.exceptionMonths > 1 ? "s" : ""}. Les montants
            ci-dessus décrivent {month ? `${formatMonthShort(month)} hors exceptions` : "un mois normal"} ; le plan
            ci-dessous inclut les exceptions.
          </p>
        ) : null}
        {preview.invalidAmounts > 0 ? (
          <p className="text-amber-900">
            {preview.invalidAmounts === 1
              ? "1 montant invalide est ignoré dans les totaux."
              : `${preview.invalidAmounts} montants invalides sont ignorés dans les totaux.`}
          </p>
        ) : null}
        <Separator />
        {k && firstMonth ? (
          <dl>
            <Row label="Disponible le 1er mois" className={firstMonth.available < 0 ? NEGATIVE : undefined}>
              {formatEuros(firstMonth.available)}
            </Row>
            <Row label="Épargne déménagement nécessaire / mois">
              {k.deadlineBeforeStart ? "Date limite dépassée" : formatEuros(k.movingMonthlyNeeded)}
            </Row>
            <Row label="Déménagement" className={k.movingGoalMet ? "font-medium text-green-800" : NEGATIVE}>
              {k.movingGoalMet ? "✓ " : "✗ "}
              {movingStatusText(k)}
            </Row>
            <Row label="Objectif déménagement atteint">{movingReachedText(k)}</Row>
            <Row label="Fonds d’urgence atteint">{emergencyReachedText(k)}</Row>
            <Row label="Fin des dettes">{debtFreeText(k)}</Row>
            <Row label="Mois en budget négatif" className={k.negativeBudgetMonths > 0 ? NEGATIVE : undefined}>
              {k.negativeBudgetMonths > 0 ? `${k.negativeBudgetMonths} (à corriger)` : "0"}
            </Row>
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
        {footer}
      </CardContent>
    </Card>
  );
}
