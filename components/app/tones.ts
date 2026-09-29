/**
 * Shared colour vocabulary (docs/design/README.md §1). Colours are CSS tokens from app/globals.css:
 * ① moving = ochre, ② emergency = forest green, debts / early repayment = brick, free savings =
 * lavender, budget = warm greys. Text colours are the "ink" shades, ≥ 4.5:1 on their tint and on white.
 */
import type { ActualStatus } from "@/lib/engine";

export const PLAN_GROUP = {
  available: {
    label: "Budget du mois",
    swatch: "bg-bucket-payments",
    header: "text-muted-foreground",
    cell: "",
    text: "text-muted-foreground",
    stroke: "var(--bucket-payments)",
  },
  moving: {
    label: "① Objectifs d’épargne",
    swatch: "bg-bucket-moving",
    header: "text-bucket-moving-ink",
    cell: "bg-bucket-moving-tint",
    text: "text-bucket-moving-ink",
    stroke: "var(--bucket-moving)",
  },
  emergency: {
    label: "② Fonds d’urgence",
    swatch: "bg-bucket-emergency",
    header: "text-bucket-emergency-ink",
    cell: "bg-bucket-emergency-tint",
    text: "text-bucket-emergency-ink",
    stroke: "var(--bucket-emergency)",
  },
  remainder: {
    label: "③ Reste du mois",
    swatch: "bg-bucket-remainder",
    header: "text-bucket-remainder-ink",
    cell: "bg-bucket-remainder-tint/40",
    text: "text-bucket-remainder-ink",
    // Lines use the darker shade: the fill is too light for a 2px stroke on white.
    stroke: "var(--bucket-remainder-line)",
  },
  debts: {
    label: "Dettes",
    swatch: "bg-bucket-debts",
    header: "text-bucket-debts-ink",
    cell: "bg-bucket-debts-tint",
    text: "text-bucket-debts-ink",
    stroke: "var(--bucket-debts)",
  },
} as const;

export type PlanGroup = keyof typeof PLAN_GROUP;

/** Allocation phases (dashboard roadmap, plan overview): small swatch and band fill. */
export const PHASE_STYLE = {
  moving: { swatch: "bg-bucket-moving", band: "bg-bucket-moving text-on-bucket-moving" },
  emergency: { swatch: "bg-bucket-emergency", band: "bg-bucket-emergency text-white" },
  repay: { swatch: "bg-bucket-debts", band: "bg-bucket-debts text-white" },
  free: { swatch: "bg-bucket-remainder", band: "bg-bucket-remainder-tint text-bucket-remainder-ink" },
} as const;

export const STATUS_TONE: Record<ActualStatus, { badge: string; dot: string; text: string; tile: string }> = {
  onTrack: { badge: "bg-good-bg text-good border-good-border", dot: "bg-good", text: "text-good", tile: "border-good-border bg-good-bg" },
  mixed: {
    badge: "bg-warning-bg text-warning border-warning-border",
    dot: "bg-bucket-moving",
    text: "text-warning",
    tile: "border-warning-border bg-warning-bg",
  },
  late: { badge: "bg-bad-bg text-bad border-bad-border", dot: "bg-bad", text: "text-bad", tile: "border-bad-border bg-bad-bg" },
};

/** Good gap = green text, bad gap = red text (SPEC §8.2). */
export const GAP_TONE = { good: "text-good", bad: "text-bad" } as const;
