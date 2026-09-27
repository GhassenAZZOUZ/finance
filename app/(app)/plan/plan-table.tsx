import { CircleCheck, Flag, PencilLine, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { PLAN_GROUP, type PlanGroup } from "@/components/app/tones";
import type { Cents, PlanMonth } from "@/lib/engine";
import { formatEuros, formatMonthShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExceptionMarker, MonthExceptions } from "./exceptions";
import { type MilestoneState, type PlanMilestones, milestoneState } from "./milestones";

/** Milestone highlights: strong = dark group shade (white text ≥ 4.5:1), light = tint. */
const HIGHLIGHT: Record<"moving" | "emergency" | "debts", { strong: string; light: string }> = {
  moving: { strong: "bg-[#9C4409] text-white", light: "bg-[#C65911]/15" },
  emergency: { strong: "bg-[#3F6428] text-white", light: "bg-[#548235]/15" },
  debts: { strong: "bg-[#A00000] text-white", light: "bg-[#C00000]/10" },
};

/** PlanMonth fields holding an amount in cents. */
type AmountKey = { [K in keyof PlanMonth]: PlanMonth[K] extends Cents ? K : never }[keyof PlanMonth];

/** Milestone shown in a column, with its visible / screen-reader marker text (SPEC D11). */
interface ColumnMilestone {
  milestone: "movingIndex" | "emergencyIndex" | "debtFreeIndex";
  tone: keyof typeof HIGHLIGHT;
  marker: string;
  srText: string;
}

/**
 * One table column. So that the whole table fits a desktop page without horizontal
 * scrolling, a flow and its running total share a column: the flow on line 1, "Cumul …" below.
 */
interface Column {
  key: AmountKey;
  label: string;
  group: PlanGroup;
  /** Running total shown as a second line in the same cell. */
  cumulative?: AmountKey;
  /** Milestone reached by this column's total: highlights the cell. */
  milestone?: ColumnMilestone;
}

const COLUMNS: Column[] = [
  { key: "income", label: "Revenus", group: "available" },
  { key: "expenses", label: "Dépenses", group: "available" },
  { key: "loanPayments", label: "Mensualités", group: "available" },
  { key: "available", label: "Disponible", group: "available" },
  {
    key: "toMoving",
    label: "→ Déménagement",
    group: "moving",
    cumulative: "movingCumulative",
    milestone: { milestone: "movingIndex", tone: "moving", marker: "Objectif atteint", srText: "objectif déménagement atteint ce mois-ci" },
  },
  {
    key: "toEmergency",
    label: "→ Fonds d'urgence",
    group: "emergency",
    cumulative: "emergencyCumulative",
    milestone: { milestone: "emergencyIndex", tone: "emergency", marker: "Fonds complet", srText: "fonds d'urgence complet ce mois-ci" },
  },
  { key: "remainder", label: "Reste", group: "remainder" },
  { key: "toEarlyRepayment", label: "→ Remb. anticipé", group: "remainder" },
  { key: "toFreeSavings", label: "→ Épargne libre", group: "remainder", cumulative: "freeSavingsCumulative" },
  {
    key: "remainingDebt",
    label: "Dettes restantes",
    group: "debts",
    milestone: { milestone: "debtFreeIndex", tone: "debts", marker: "Plus de dettes", srText: "toutes les dettes sont soldées ce mois-ci" },
  },
];

const GROUPS: PlanGroup[] = ["available", "moving", "emergency", "remainder", "debts"];

/** First column of each group gets a separator border. */
const GROUP_START = new Set(GROUPS.map((g) => COLUMNS.find((c) => c.group === g)?.key));

/**
 * Sticky header rows. Below xl the table scrolls inside its own box and the header sticks to
 * the box top. From xl the table fits the page width and the page scrolls instead, so the
 * header sticks right below the sticky app header (h-14). Row 1 is h-9 so row 2 can stick
 * right below it (9 = 2.25rem, 14 + 9 = 5.75rem).
 */
const HEAD_ROW_1 = "sticky top-0 z-20 h-9 lg:top-14";
const HEAD_ROW_2 = "sticky top-9 z-20 lg:top-[5.75rem]";

const NO_EXCEPTIONS: MonthExceptions = { income: [], expense: [] };

export function PlanTable({
  months,
  milestones,
  exceptions,
  caption,
}: {
  months: PlanMonth[];
  milestones: PlanMilestones;
  /** Plan month index → that month's one-off exceptions (SPEC D14), see `exceptionsByPlanIndex`. */
  exceptions: ReadonlyMap<number, MonthExceptions>;
  caption: ReactNode;
}) {
  return (
    // `relative` on purpose: the absolutely positioned sr-only texts would otherwise widen the page.
    // Below lg: own scroll box (sticky month column). From lg the table fits: no scroll box, the page scrolls.
    <div
      tabIndex={0}
      role="region"
      aria-label="Tableau du plan mois par mois"
      className="relative max-h-[75vh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:max-h-none lg:overflow-visible"
    >
      <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums xl:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              rowSpan={2}
              className={cn(HEAD_ROW_1, "left-0 z-30 border-b border-r bg-muted px-1 xl:px-2 py-2 text-left align-bottom font-medium lg:z-20")}
            >
              Mois
            </th>
            {GROUPS.map((g) => (
              <th
                key={g}
                scope="colgroup"
                colSpan={COLUMNS.filter((c) => c.group === g).length}
                className={cn(HEAD_ROW_1, "border-l border-b border-white px-1 xl:px-2 text-center font-semibold whitespace-nowrap", PLAN_GROUP[g].header)}
              >
                {PLAN_GROUP[g].label}
              </th>
            ))}
          </tr>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  HEAD_ROW_2,
                  "border-b bg-background px-1 xl:px-2 py-2 text-right align-bottom text-xs font-medium",
                  PLAN_GROUP[c.group].text,
                  GROUP_START.has(c.key) && "border-l",
                )}
              >
                {c.label}
                {c.cumulative ? <span className="block font-normal">et cumul</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <PlanRow key={m.index} month={m} milestones={milestones} exceptions={exceptions.get(m.index) ?? NO_EXCEPTIONS} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanRow({ month: m, milestones, exceptions }: { month: PlanMonth; milestones: PlanMilestones; exceptions: MonthExceptions }) {
  const negative = m.negativeBudget;
  const isDeadline = milestones.deadlineIndex === m.index;
  const paidOff = milestones.loanPayoffs.get(m.index) ?? [];
  // Negative months: the whole row is red instead of the group tints.
  const rowTone = negative ? "bg-red-100 text-red-950" : "";
  return (
    <tr className={rowTone}>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 border-b border-r px-1 xl:px-2 py-1.5 text-left align-top font-medium whitespace-nowrap",
          negative ? "bg-red-100" : "bg-background",
        )}
      >
        {formatMonthShort(m.month)}
        <span className={cn("block text-xs font-normal", negative ? "text-red-900" : "text-muted-foreground")}>mois {m.index}</span>
      </th>
      {COLUMNS.map((c) => {
        const milestone = c.milestone;
        const state: MilestoneState = milestone ? milestoneState(m.index, milestones[milestone.milestone]) : null;
        const tone = negative
          ? "bg-red-100"
          : state === "first"
            ? cn(HIGHLIGHT[milestone!.tone].strong, "font-semibold")
            : state === "after"
              ? HIGHLIGHT[milestone!.tone].light
              : PLAN_GROUP[c.group].cell;
        // Secondary lines use the dark group shade, except on the strong highlight (white) and red rows.
        const secondaryText = !negative && state !== "first" ? PLAN_GROUP[c.group].text : undefined;
        return (
          <td key={c.key} className={cn("border-b px-1 xl:px-2 py-1.5 text-right align-top", tone, GROUP_START.has(c.key) && "border-l")}>
            <span className="whitespace-nowrap">{formatEuros(m[c.key])}</span>
            {c.cumulative ? (
              <span className={cn("block text-[13px] whitespace-nowrap", secondaryText)}>
                {/* The header already says "et cumul": the word is only visible where there is room. */}
                <span className="sr-only xl:not-sr-only">Cumul </span>
                {formatEuros(m[c.cumulative])}
              </span>
            ) : null}
            {state === "first" && milestone ? (
              <Marker icon={<CircleCheck aria-hidden className="size-3.5" />}>
                {milestone.marker}
                <span className="sr-only"> : {milestone.srText}</span>
              </Marker>
            ) : null}
            {c.key === "toEarlyRepayment" && m.unusedEarlyRepayment > 0 ? (
              <span className={cn("block text-[13px]", secondaryText)} title="Non utilisé (dettes soldées) : versé à l'épargne libre">
                dont non utilisé <span className="whitespace-nowrap">{formatEuros(m.unusedEarlyRepayment)}</span>
                <span aria-hidden> → épargne</span>
                <span className="sr-only"> (dettes soldées), versé à l&apos;épargne libre</span>
              </span>
            ) : null}
            {c.key === "income" && m.extraIncome > 0 ? (
              <ExceptionNote amount={m.extraIncome} list={exceptions.income} kind="revenu" />
            ) : null}
            {c.key === "expenses" && m.extraExpenses > 0 ? (
              <ExceptionNote amount={m.extraExpenses} list={exceptions.expense} kind="dépense" />
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
                    className="mt-1 ml-auto flex w-fit items-start gap-1 rounded-lg border border-[#A00000] bg-white px-1 xl:px-2 py-0.5 text-right text-xs font-medium text-[#A00000]"
                  >
                    <CircleCheck aria-hidden className="mt-px size-3.5 shrink-0" />
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

/** Small marker under an amount; its text may wrap to keep the column narrow. */
function Marker({ icon, className, children }: { icon: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={cn("mt-0.5 flex items-start justify-end gap-1 text-right text-xs", className)}>
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

/**
 * One-off exception marker (SPEC D14) under the Revenus / Dépenses amount: a badge with the
 * extra amount and, below it, the label(s) — truncated to keep the column narrow,
 * with the full text in `title` and in sr-only text.
 */
function ExceptionNote({ amount, list, kind }: { amount: Cents; list: readonly ExceptionMarker[]; kind: "revenu" | "dépense" }) {
  const detail = list.map((e) => `${e.label} (+${formatEuros(e.amount)})`).join(", ");
  const labels = list.length > 1 ? `${list.length} exceptions : ${list.map((e) => e.label).join(", ")}` : (list[0]?.label ?? "");
  const srText =
    list.length > 1
      ? `dont ${list.length} exceptions ponctuelles (${kind}s en plus) : ${detail}`
      : list.length === 1
        ? `dont exception ponctuelle (${kind} en plus) : ${detail}`
        : `dont +${formatEuros(amount)} d'exception ponctuelle (${kind} en plus)`;
  return (
    <span className="mt-1 flex flex-col items-end gap-0.5 text-xs" title={detail || undefined}>
      <span className="sr-only">{srText}</span>
      <span
        aria-hidden
        className="flex w-fit items-center gap-1 rounded-full border border-[#1F4E78] bg-white px-1.5 py-0.5 font-medium whitespace-nowrap text-[#1F4E78]"
      >
        <PencilLine className="size-3.5" />+{formatEuros(amount)}
      </span>
      {labels ? (
        <span aria-hidden className="max-w-28 truncate text-[#1F4E78]">
          {labels}
        </span>
      ) : null}
    </span>
  );
}
