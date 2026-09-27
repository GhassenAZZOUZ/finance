"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatEuros, formatEurosWhole } from "@/lib/format";

/** "ring" = hollow circle, for planned values next to filled actual markers. */
export type Marker = "none" | "circle" | "square" | "ring";

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
  /** Secondary encoding where two hues are too close for colour-blind readers. */
  marker?: Marker;
  /** Draw the line across null values (e.g. a plan that continues through months without data). */
  connectGaps?: boolean;
}

/** A null value is a gap (e.g. a month without check-in): the line breaks there. */
type Row = { label: string } & Record<string, number | string | null>;

const MUTED = "var(--muted-foreground)";
const eurosToCents = (euros: number) => Math.round(euros * 100);

function MarkerShape({ marker, color, cx, cy, size = 4 }: { marker: Marker; color: string; cx: number; cy: number; size?: number }) {
  // 2px ring in the surface colour keeps markers legible where lines cross.
  if (marker === "ring") {
    return <circle cx={cx} cy={cy} r={size} fill="var(--card)" stroke={color} strokeWidth={2} />;
  }
  if (marker === "square") {
    return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} fill={color} stroke="var(--card)" strokeWidth={2} />;
  }
  return <circle cx={cx} cy={cy} r={size} fill={color} stroke="var(--card)" strokeWidth={2} />;
}

function LegendKey({ series }: { series: ChartSeries }) {
  return (
    <svg aria-hidden width={28} height={12} viewBox="0 0 28 12" className="shrink-0">
      <line
        x1={1}
        x2={27}
        y1={6}
        y2={6}
        stroke={series.color}
        strokeWidth={2}
        strokeDasharray={series.dashed ? "5 3" : undefined}
        strokeLinecap="round"
      />
      {series.marker && series.marker !== "none" ? <MarkerShape marker={series.marker} color={series.color} cx={14} cy={6} size={3.5} /> : null}
    </svg>
  );
}

function ChartTooltip({ active, payload, label, series }: TooltipContentProps & { series: ChartSeries[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="flex flex-col gap-1">
        {series.map((s) => {
          const entry = payload.find((p) => p.dataKey === s.key);
          if (!entry || typeof entry.value !== "number") return null;
          return (
            <li key={s.key} className="flex items-center gap-2">
              <svg aria-hidden width={12} height={4} className="shrink-0">
                <line x1={0} x2={12} y1={2} y2={2} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "3 2" : undefined} />
              </svg>
              <span className="font-semibold tabular-nums">{formatEuros(eurosToCents(entry.value))}</span>
              <span className="text-muted-foreground">{s.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Euro line chart with an HTML legend, a text alternative (role="img") and a data-table fallback.
 * Values are euros (converted from cents by the caller).
 */
export function PlanLineChart({
  data,
  series,
  summary,
  tableCaption,
  todayLabel,
}: {
  data: Row[];
  series: ChartSeries[];
  summary: string;
  tableCaption: string;
  /** x label of the current month: drawn as a dashed "Aujourd’hui" line. */
  todayLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <LegendKey series={s} />
            {s.name}
          </li>
        ))}
      </ul>

      <div role="img" aria-label={summary} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--divider)" />
            <XAxis
              dataKey="label"
              tick={{ fill: MUTED, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              width={76}
              tick={{ fill: MUTED, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              // From 0, or lower when a series goes negative (e.g. simulated free savings).
              domain={[(dataMin: number) => Math.min(0, dataMin), "auto"]}
              tickFormatter={(v: number) => formatEurosWhole(eurosToCents(v))}
            />
            {todayLabel ? (
              <ReferenceLine
                x={todayLabel}
                stroke="var(--foreground)"
                strokeDasharray="3 3"
                label={{ value: "Aujourd’hui", position: "insideTopLeft", fill: "var(--foreground)", fontSize: 12 }}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: MUTED, strokeWidth: 1 }}
              content={(props) => <ChartTooltip {...props} series={series} />}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2.5}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls={s.connectGaps ?? false}
                isAnimationActive={false}
                dot={
                  s.marker && s.marker !== "none"
                    ? ({ cx, cy, index }) =>
                        cx === undefined || cy === undefined ? null : (
                          <MarkerShape key={`${s.key}-${index}`} marker={s.marker!} color={s.color} cx={cx} cy={cy} />
                        )
                    : false
                }
                activeDot={s.dashed ? false : { r: 5, stroke: "var(--card)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Voir les données
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <caption className="sr-only">{tableCaption}</caption>
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  Mois
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.label} className="border-t">
                  <th scope="row" className="px-2 py-1 text-left font-normal whitespace-nowrap">
                    {row.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                      {typeof row[s.key] === "number" ? formatEuros(eurosToCents(row[s.key] as number)) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
