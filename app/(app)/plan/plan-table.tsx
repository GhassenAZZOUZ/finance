import type { ReactNode } from "react";
import { PLAN_GROUP, type PlanGroup } from "@/components/app/tones";
import type { Cents, PlanMonth } from "@/lib/engine";
import { formatEuros } from "@/lib/format";
import { cn } from "@/lib/utils";
import { type PhaseKind, type PlanPhase, phaseLabel } from "../_dashboard/logic";
import type { ExceptionMarker, MonthExceptions } from "./exceptions";
import type { PlanMilestones } from "./milestones";

/** PlanMonth fields holding an amount in cents. */
type AmountKey = { [K in keyof PlanMonth]: PlanMonth[K] extends Cents ? K : never }[keyof PlanMonth];

/** One column; a flow and its running total share a cell (flow, then the total on a second line). */
interface Column {
  key: AmountKey;
  label: string;
  group: PlanGroup;
  cumulative?: AmountKey;
  /** Allocation: 0 is shown as "—". */
  allocation?: boolean;
}

const COLUMNS: Column[] = [
  { key: "income", label: "Revenus", group: "available" },
  { key: "expenses", label: "Dépenses", group: "available" },
  { key: "loanPayments", label: "Mensualités", group: "available" },
  { key: "available", label: "Disponible", group: "available" },
  { key: "toMoving", label: "Versé", group: "moving", cumulative: "movingCumulative", allocation: true },
  { key: "toEmergency", label: "Versé", group: "emergency", cumulative: "emergencyCumulative", allocation: true },
  { key: "toEarlyRepayment", label: "Remb. anticipé", group: "remainder", allocation: true },
  { key: "toFreeSavings", label: "Épargne libre", group: "remainder", cumulative: "freeSavingsCumulative", allocation: true },
  { key: "remainingDebt", label: "Restant dû", group: "debts" },
];

const GROUP_HEAD: { group: PlanGroup; label: string; className: string }[] = [
  { group: "available", label: "Budget du mois", className: "text-muted-foreground" },
  { group: "moving", label: "① Déménag.", className: "text-bucket-moving-ink" },
  { group: "emergency", label: "② Urgence", className: "text-bucket-emergency-ink" },
  { group: "remainder", label: "③ Reste du mois", className: "text-bucket-debts-ink" },
  { group: "debts", label: "Dettes", className: "text-bucket-debts-ink" },
];

/** First column of each group gets a separator. */
const GROUP_START = new Set(GROUP_HEAD.map((g) => COLUMNS.find((c) => c.group === g.group)?.key));

const HEAD_1 = "sticky top-0 z-20 h-9 bg-card";
const HEAD_2 = "sticky top-9 z-20 bg-card";

const NO_EXCEPTIONS: MonthExceptions = { income: [], expense: [] };

function monthName(m: PlanMonth): string {
  // "2026-07" → "juil." (the year is in the separator row).
  return new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5)) - 1, 1));
}

/** Phases active during some of `months`, in order: names the year separator rows. */
function phasesOf(months: readonly PlanMonth[], phases: readonly PlanPhase[]): PhaseKind[] {
  const first = months[0]?.index ?? 0;
  const last = months.at(-1)?.index ?? 0;
  return phases.filter((p) => p.startIndex <= last && p.endIndex >= first).map((p) => p.kind);
}

export function PlanTable({
  months,
  milestones,
  exceptions,
  phases,
  todayIndex,
  earlyRepaymentPct,
  movingGoalMet,
  goalsName = "Déménagement",
  primaryName = "Déménagement",
  caption,
}: {
  months: PlanMonth[];
  milestones: PlanMilestones;
  /** Plan month index → that month's one-off exceptions (SPEC D14), see `exceptionsByPlanIndex`. */
  exceptions: ReadonlyMap<number, MonthExceptions>;
  phases: readonly PlanPhase[];
  /** Plan month of today (the KPIs' reference month): highlighted row. */
  todayIndex: number;
  earlyRepaymentPct: number;
  /** Whether the moving goal is met at the deadline (deadline chip wording). */
  movingGoalMet?: boolean;
  /** Savings-goals bucket name and the primary goal's name (SPEC D23). */
  goalsName?: string;
  primaryName?: string;
  caption: ReactNode;
}) {
  const years = new Map<string, PlanMonth[]>();
  for (const m of months) {
    const year = m.month.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), m]);
  }
  return (
    // `relative`: the absolutely positioned sr-only texts must not widen the page.
    <div
      tabIndex={0}
      role="region"
      aria-label="Tableau du plan mois par mois"
      className="relative max-h-[78vh] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums md:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD_1, "left-0 z-30 min-w-40")}>
              <span className="sr-only">Mois</span>
            </th>
            {GROUP_HEAD.map((g) => ({
              ...g,
              label: g.group === "moving" && goalsName !== "Déménagement" ? `① ${goalsName}` : g.label,
            })).map((g) => (
              <th
                key={g.group}
                scope="colgroup"
                colSpan={COLUMNS.filter((c) => c.group === g.group).length}
                className={cn(
                  HEAD_1,
                  "px-3 pt-2.5 pb-1.5 text-left text-xs font-semibold tracking-[0.03em] whitespace-nowrap uppercase",
                  g.className,
                  g.group !== "available" && "border-l border-divider",
                )}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            <th scope="col" className={cn(HEAD_2, "left-0 z-30 border-b px-3 py-2.5 text-left text-xs font-medium text-muted-foreground")}>
              Mois
            </th>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  HEAD_2,
                  "border-b px-3 py-2.5 text-right align-bottom text-xs leading-tight font-medium text-muted-foreground",
                  c.key === "available" && "text-foreground",
                  GROUP_START.has(c.key) && c.group !== "available" && "border-l border-l-divider",
                )}
              >
                {c.label}
                {c.cumulative ? <span className="block font-normal">cumul</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        {[...years].map(([year, yearMonths]) => (
          <tbody key={year}>
            <tr>
              <th
                scope="rowgroup"
                colSpan={COLUMNS.length + 1}
                className="sticky left-0 border-b border-divider bg-secondary px-3 py-2 text-left text-[13px] font-semibold"
              >
                {year}
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {phasesOf(yearMonths, phases)
                    .map((kind, i) => {
                      const label = phaseLabel(kind, earlyRepaymentPct, goalsName);
                      return i === 0 ? label : label.charAt(0) + label.slice(1).toLowerCase();
                    })
                    .join(", puis ")}
                </span>
              </th>
            </tr>
            {yearMonths.map((m) => (
              <PlanRow
                key={m.index}
                month={m}
                milestones={milestones}
                exceptions={exceptions.get(m.index) ?? NO_EXCEPTIONS}
                today={m.index === todayIndex}
                movingGoalMet={movingGoalMet}
                goalsName={goalsName}
                primaryName={primaryName}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PlanRow({
  month: m,
  milestones,
  exceptions,
  today,
  movingGoalMet,
  goalsName,
  primaryName,
}: {
  month: PlanMonth;
  milestones: PlanMilestones;
  exceptions: MonthExceptions;
  today: boolean;
  movingGoalMet?: boolean;
  goalsName: string;
  primaryName: string;
}) {
  const negative = m.negativeBudget;
  const isDeadline = milestones.deadlineIndex === m.index;
  const movingHit = milestones.movingIndex === m.index;
  const emergencyHit = milestones.emergencyIndex === m.index;
  const debtFree = milestones.debtFreeIndex === m.index;
  const paidOff = milestones.loanPayoffs.get(m.index) ?? [];
  const rowBg = negative ? "bg-bad-bg" : today ? "bg-row-highlight" : "bg-card";
  return (
    <tr className={negative ? "text-bad" : undefined}>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 border-b border-divider px-3 py-2.5 text-left align-top font-normal",
          rowBg,
          today && "shadow-[inset_3px_0_0_var(--foreground)]",
        )}
      >
        <b className="block font-semibold">
          {monthName(m)}
          <span className="sr-only"> {m.month.slice(0, 4)}</span>
        </b>
        <span className="flex max-w-52 flex-wrap gap-1">
          {today ? <Chip className="bg-primary text-primary-foreground">Aujourd’hui</Chip> : null}
          {negative ? <Chip className="bg-bad text-white">Budget négatif</Chip> : null}
          {/* Loan names are not unique (two loans can share one): key by position. */}
          {paidOff.map((name, i) => (
            <Chip key={i} className="bg-bucket-debts-tint text-bucket-debts-ink">
              {name} soldé
            </Chip>
          ))}
          {debtFree ? <Chip className="bg-bucket-debts text-white">Plus de dettes</Chip> : null}
          {isDeadline ? (
            <Chip className="bg-warning-bg text-warning">
              Date limite {primaryName.toLocaleLowerCase("fr")}
              {movingGoalMet === undefined ? "" : movingGoalMet ? " · objectif tenu" : " · objectif non tenu"}
            </Chip>
          ) : null}
          {movingHit ? (
            <Chip className="bg-bucket-moving text-on-bucket-moving">
              {goalsName === "Objectifs" ? "Objectifs financés" : `${goalsName} financé`}
            </Chip>
          ) : null}
          {emergencyHit ? <Chip className="bg-bucket-emergency text-white">Fonds d’urgence complet</Chip> : null}
          {m.extraIncome > 0 ? <ExceptionChip amount={m.extraIncome} list={exceptions.income} kind="income" /> : null}
          {m.extraExpenses > 0 ? <ExceptionChip amount={m.extraExpenses} list={exceptions.expense} kind="expense" /> : null}
        </span>
      </th>
      {COLUMNS.map((c) => {
        const value = m[c.key];
        const hit =
          !negative &&
          ((c.key === "toMoving" && (movingHit || isDeadline)) || (c.key === "toEmergency" && emergencyHit));
        return (
          <td
            key={c.key}
            className={cn(
              "border-b border-divider px-3 py-2.5 text-right align-top whitespace-nowrap",
              rowBg,
              hit && PLAN_GROUP[c.group].cell,
              GROUP_START.has(c.key) && c.group !== "available" && "border-l border-l-divider",
              c.key === "available" && "font-semibold",
              c.key === "remainingDebt" && !negative && "font-medium text-bucket-debts-ink",
            )}
          >
            {c.allocation && value === 0 ? (
              <>
                <span aria-hidden className="text-faint">
                  —
                </span>
                <span className="sr-only">{formatEuros(0)}</span>
              </>
            ) : (
              formatEuros(value)
            )}
            {c.cumulative ? (
              <small className={cn("mt-0.5 block text-xs", negative ? "text-bad" : "text-muted-foreground")}>
                <span className="sr-only">cumul </span>
                {formatEuros(m[c.cumulative])}
              </small>
            ) : null}
            {c.key === "toEarlyRepayment" && m.unusedEarlyRepayment > 0 ? (
              <small className="mt-0.5 block text-xs text-muted-foreground" title="Non utilisé (dettes soldées) : versé à l’épargne libre">
                dont {formatEuros(m.unusedEarlyRepayment)} → épargne
                <span className="sr-only"> (non utilisé, dettes soldées)</span>
              </small>
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}

function Chip({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap", className)}>
      {children}
    </span>
  );
}

/** One-off exception (SPEC D14): sign + amount visible, labels in the tooltip and for screen readers. */
function ExceptionChip({ amount, list, kind }: { amount: Cents; list: readonly ExceptionMarker[]; kind: "income" | "expense" }) {
  const detail = list.map((e) => `${e.label} (${formatEuros(e.amount)})`).join(", ");
  const noun = kind === "income" ? "revenu" : "dépense";
  return (
    <Chip
      title={detail || undefined}
      className={kind === "income" ? "border border-good-border bg-good-bg text-good" : "border border-bad-border bg-bad-bg text-bad"}
    >
      <span aria-hidden>
        Exception {kind === "income" ? "+" : "−"}
        {formatEuros(amount)}
      </span>
      <span className="sr-only">
        {list.length > 1 ? `${list.length} exceptions ponctuelles` : "Exception ponctuelle"} ({noun}
        {list.length > 1 ? "s" : ""} en plus, {formatEuros(amount)}){detail ? ` : ${detail}` : ""}
      </span>
    </Chip>
  );
}
