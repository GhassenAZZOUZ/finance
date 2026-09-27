/**
 * Shared colour vocabulary. The plan groups reuse the spreadsheet's header colours
 * (① blue, ② orange, ③ green, ④ purple, debts red); statuses use green / orange / red.
 * Text colours are the dark shades so they keep ≥ 4.5:1 contrast on white.
 */
import type { ActualStatus } from "@/lib/engine";

export const PLAN_GROUP = {
  available: { label: "① Argent du mois", header: "bg-[#1F4E78] text-white", cell: "bg-[#1F4E78]/5", text: "text-[#1F4E78]", stroke: "#1F4E78" },
  moving: { label: "② Déménagement", header: "bg-[#C65911] text-white", cell: "bg-[#C65911]/5", text: "text-[#9C4409]", stroke: "#C65911" },
  emergency: { label: "③ Fonds d'urgence", header: "bg-[#548235] text-white", cell: "bg-[#548235]/5", text: "text-[#3F6428]", stroke: "#548235" },
  remainder: { label: "④ Ce qui reste", header: "bg-[#7030A0] text-white", cell: "bg-[#7030A0]/5", text: "text-[#5E2887]", stroke: "#7030A0" },
  debts: { label: "Dettes", header: "bg-[#C00000] text-white", cell: "bg-[#C00000]/5", text: "text-[#A00000]", stroke: "#C00000" },
} as const;

export type PlanGroup = keyof typeof PLAN_GROUP;

export const STATUS_TONE: Record<ActualStatus, { badge: string; dot: string }> = {
  onTrack: { badge: "bg-green-100 text-green-900 border-green-300", dot: "bg-green-600" },
  mixed: { badge: "bg-amber-100 text-amber-900 border-amber-300", dot: "bg-amber-500" },
  late: { badge: "bg-red-100 text-red-900 border-red-300", dot: "bg-red-600" },
};

/** Good gap = green text, bad gap = red text (SPEC §8.2). */
export const GAP_TONE = { good: "text-green-800", bad: "text-red-700" } as const;
