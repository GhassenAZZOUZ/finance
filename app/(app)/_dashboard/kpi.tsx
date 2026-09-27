import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Tone = "good" | "warning" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-green-800",
  warning: "text-amber-800",
  bad: "text-red-700",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  good: CircleCheck,
  warning: TriangleAlert,
  bad: CircleAlert,
};

/** Dashboard card holding a list of KPI rows. */
export function KpiCard({ title, icon: Icon, children, footer }: { title: string; icon: LucideIcon; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          <h2>{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <dl className="flex flex-col divide-y">{children}</dl>
        {footer}
      </CardContent>
    </Card>
  );
}

/** One label/value pair. `hint` sits under the value (e.g. an explanation or the alert text). */
export function KpiRow({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right font-semibold tabular-nums ${tone ? TONE_TEXT[tone] : ""}`}>{value}</dd>
      {hint ? <dd className="w-full text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Coloured text with an icon, so colour is never the only signal. */
export function ToneText({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1 ${TONE_TEXT[tone]}`}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
