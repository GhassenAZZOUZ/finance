import { CircleCheck, Flag, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { PLAN_GROUP, type PlanGroup } from "@/components/app/tones";
import type { Cents, PlanMonth } from "@/lib/engine";
import { formatEuros, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type MilestoneState, type PlanMilestones, milestoneState } from "./milestones";

/** Milestone highlights: strong = dark group shade (white text ≥ 4.5:1), light = tint. */
const HIGHLIGHT: Record<"moving" | "emergency" | "debts", { strong: string; light: string }> = {
  moving: { strong: "bg-[#9C4409] text-white", light: "bg-[#C65911]/15" },
  emergency: { strong: "bg-[#3F6428] text-white", light: "bg-[#548235]/15" },
  debts: { strong: "bg-[#A00000] text-white", light: "bg-[#C00000]/10" },
};

/** PlanMonth fields holding an amount in cents. */
type AmountKey = { [K in keyof PlanMonth]: PlanMonth[K] extends Cents ? K : never }[keyof PlanMonth];

interface Column {
  key: AmountKey;
  label: string;
  group: PlanGroup;
}

const COLUMNS: Column[] = [
  { key: "income", label: "Revenus", group: "available" },
  { key: "expenses", label: "Dépenses (fixes + var.)", group: "available" },
  { key: "loanPayments", label: "Mensualités crédits", group: "available" },
  { key: "available", label: "Disponible", group: "available" },
  { key: "toMoving", label: "→ Déménagement", group: "moving" },
  { key: "movingCumulative", label: "Cumul", group: "moving" },
  { key: "toEmergency", label: "→ Fonds d'urgence", group: "emergency" },
  { key: "emergencyCumulative", label: "Cumul", group: "emergency" },
  { key: "remainder", label: "Reste", group: "remainder" },
  { key: "toEarlyRepayment", label: "→ Remb. anticipé", group: "remainder" },
  { key: "unusedEarlyRepayment", label: "Non utilisé (dettes soldées)", group: "remainder" },
  { key: "toFreeSavings", label: "→ Épargne libre", group: "remainder" },
  { key: "freeSavingsCumulative", label: "Cumul épargne libre", group: "remainder" },
  { key: "remainingDebt", label: "Dettes restantes", group: "debts" },
];

const GROUPS: PlanGroup[] = ["available", "moving", "emergency", "remainder", "debts"];

/** First column of each group gets a separator border. */
const GROUP_START = new Set(GROUPS.map((g) => COLUMNS.find((c) => c.group === g)?.key));

/** Which milestone a cumulative column shows, with its visible / screen-reader marker text. */
const MILESTONE_COLUMNS: Partial<
  Record<AmountKey, { milestone: "movingIndex" | "emergencyIndex" | "debtFreeIndex"; tone: keyof typeof HIGHLIGHT; marker: string; srText: string }>
> = {
  movingCumulative: { milestone: "movingIndex", tone: "moving", marker: "Objectif atteint", srText: "objectif déménagement atteint ce mois-ci" },
  emergencyCumulative: { milestone: "emergencyIndex", tone: "emergency", marker: "Fonds complet", srText: "fonds d'urgence complet ce mois-ci" },
  remainingDebt: { milestone: "debtFreeIndex", tone: "debts", marker: "Plus de dettes", srText: "toutes les dettes sont soldées ce mois-ci" },
};

// Row 1 of the header is h-9 so row 2 can stick right below it (top-9).
const HEAD_ROW_1 = "sticky top-0 z-20 h-9";
const HEAD_ROW_2 = "sticky top-9 z-20";

export function PlanTable({ months, milestones, caption }: { months: PlanMonth[]; milestones: PlanMilestones; caption: ReactNode }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Tableau du plan mois par mois (défilement horizontal et vertical)"
      className="relative max-h-[75vh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="colgroup" colSpan={2} className={cn(HEAD_ROW_1, "left-0 z-30 border-b bg-muted px-2 text-left font-semibold")}>
              Période
            </th>
            {GROUPS.map((g) => (
              <th
                key={g}
                scope="colgroup"
                colSpan={COLUMNS.filter((c) => c.group === g).length}
                className={cn(HEAD_ROW_1, "border-l border-b border-white px-2 text-center font-semibold whitespace-nowrap", PLAN_GROUP[g].header)}
              >
                {PLAN_GROUP[g].label}
              </th>
            ))}
          </tr>
          <tr>
            <th scope="col" className={cn(HEAD_ROW_2, "border-b bg-muted px-2 py-2 text-right align-bottom font-medium")}>
              N°
            </th>
            <th scope="col" className={cn(HEAD_ROW_2, "left-0 z-30 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium")}>
              Mois
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  HEAD_ROW_2,
                  "min-w-28 border-b bg-background px-2 py-2 text-right align-bottom text-xs font-medium",
                  PLAN_GROUP[c.group].text,
                  GROUP_START.has(c.key) && "border-l",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <PlanRow key={m.index} month={m} milestones={milestones} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanRow({ month: m, milestones }: { month: PlanMonth; milestones: PlanMilestones }) {
  const negative = m.negativeBudget;
  const isDeadline = milestones.deadlineIndex === m.index;
  const paidOff = milestones.loanPayoffs.get(m.index) ?? [];
  // Negative months: the whole row is red instead of the group tints.
  const rowTone = negative ? "bg-red-100 text-red-950" : "";
  return (
    <tr className={rowTone}>
      <td className={cn("border-b px-2 py-1.5 text-right text-muted-foreground", negative && "bg-red-100 text-red-900")}>{m.index}</td>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 border-b border-r px-2 py-1.5 text-left font-medium whitespace-nowrap",
          negative ? "bg-red-100" : "bg-background",
        )}
      >
        {formatMonthShort(m.month)}
      </th>
      {COLUMNS.map((c) => {
        const value = m[c.key];
        const milestoneCol = MILESTONE_COLUMNS[c.key];
        const state: MilestoneState = milestoneCol ? milestoneState(m.index, milestones[milestoneCol.milestone]) : null;
        const tone = negative
          ? "bg-red-100"
          : state === "first"
            ? cn(HIGHLIGHT[milestoneCol!.tone].strong, "font-semibold")
            : state === "after"
              ? HIGHLIGHT[milestoneCol!.tone].light
              : PLAN_GROUP[c.group].cell;
        return (
          <td
            key={c.key}
            className={cn("border-b px-2 py-1.5 text-right align-top whitespace-nowrap", tone, GROUP_START.has(c.key) && "border-l")}
          >
            <span>{formatEuros(value)}</span>
            {state === "first" && milestoneCol ? (
              <Marker icon={<CircleCheck aria-hidden className="size-3.5" />}>
                {milestoneCol.marker}
                <span className="sr-only"> : {milestoneCol.srText}</span>
              </Marker>
            ) : null}
            {c.key === "available" && negative ? (
              <Marker icon={<TriangleAlert aria-hidden className="size-3.5" />} className="font-semibold text-red-800">
                Budget négatif !
              </Marker>
            ) : null}
            {c.key === "toMoving" && isDeadline ? (
              <Marker icon={<Flag aria-hidden className="size-3.5" />} className={cn("font-semibold", PLAN_GROUP.moving.text)}>
                Date limite déménagement
              </Marker>
            ) : null}
            {c.key === "remainingDebt"
              ? paidOff.map((name) => (
                  <span
                    key={name}
                    className="mt-1 ml-auto flex w-fit items-center gap-1 rounded-full border border-[#A00000] bg-white px-2 py-0.5 text-xs font-medium text-[#A00000]"
                  >
                    <CircleCheck aria-hidden className="size-3.5" />
                    {name} soldé
                  </span>
                ))
              : null}
          </td>
        );
      })}
    </tr>
  );
}

function Marker({ icon, className, children }: { icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={cn("mt-0.5 flex items-center justify-end gap-1 text-xs", className)}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
