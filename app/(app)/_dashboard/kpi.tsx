import type { LucideIcon } from "lucide-react";
import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "good" | "warning" | "bad";

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-good",
  warning: "text-warning",
  bad: "text-bad",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  good: Check,
  warning: TriangleAlert,
  bad: CircleAlert,
};

/** Coloured text with an icon, so colour is never the only signal. */
export function ToneText({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5", TONE_TEXT[tone], className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />
      {children}
    </span>
  );
}

/**
 * Key figure tile: label, serif amount, a visual (bar), a detail line and a label/value footer.
 * The visual is decorative: the detail line carries the same numbers as text.
 */
export function StatTile({
  label,
  value,
  visual,
  detail,
  footerLabel,
  footerValue,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  visual?: ReactNode;
  detail?: ReactNode;
  footerLabel?: ReactNode;
  footerValue?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3.5 rounded-2xl border bg-card p-4 md:p-6", className)}>
      <h2 className="text-[13px] font-medium tracking-[0.02em] text-muted-foreground">{label}</h2>
      <p className="font-heading text-[28px] leading-none font-medium tabular-nums md:text-[44px]">{value}</p>
      {visual}
      {detail ? <p className="text-[13px] leading-normal text-muted-foreground tabular-nums">{detail}</p> : null}
      {footerLabel ? (
        <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-divider pt-3 text-sm">
          <span className="text-muted-foreground">{footerLabel}</span>
          <span className="font-semibold tabular-nums">{footerValue}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal stacked bar (decorative); widths are fractions 0..1 of the track. */
export function SegmentBar({
  segments,
  track = "",
  className,
}: {
  segments: { key: string; fraction: number; className: string }[];
  track?: string;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("flex h-2.5 gap-0.5 overflow-hidden rounded-full", track, className)}>
      {segments
        .filter((s) => s.fraction > 0)
        .map((s) => (
          <div key={s.key} className={s.className} style={{ width: `${Math.min(1, s.fraction) * 100}%` }} />
        ))}
    </div>
  );
}

/** Goal meter (decorative): filled part, optional hatched projection behind it. */
export function GoalMeter({
  fraction,
  projected,
  fill,
  track,
  hatch,
}: {
  fraction: number;
  /** Projected fraction (e.g. at the deadline), drawn hatched behind the fill. */
  projected?: number;
  fill: string;
  track: string;
  hatch?: string;
}) {
  const pct = (f: number) => `${Math.max(0, Math.min(1, f)) * 100}%`;
  return (
    <div aria-hidden className={cn("relative h-3 rounded-full", track)}>
      {projected !== undefined ? (
        <div className={cn("absolute inset-y-0 left-0 rounded-full", hatch)} style={{ width: pct(projected) }} />
      ) : null}
      <div className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: pct(fraction) }} />
    </div>
  );
}
