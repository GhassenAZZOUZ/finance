"use client";

import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatEuros, formatEurosWhole } from "@/lib/format";
import { ChartDataTable, LegendKey, MUTED, type Row, eurosToCents } from "./plan-line-chart";

export interface StackSeries {
  key: string;
  name: string;
  color: string;
  type: "bar" | "area" | "line";
  /** Series sharing a stack id are stacked (bars or areas). */
  stackId?: string;
  dashed?: boolean;
  /** Bars only: a colour per row (e.g. a good/bad tone), instead of `color`. */
  fillFor?: (row: Row) => string | undefined;
  /** Bars only: tinted fill with a coloured outline, to tell two series apart without hue. */
  outline?: boolean;
  /** Not drawn: listed in the tooltip and the table only (e.g. the month’s income). */
  tooltipOnly?: boolean;
  /** Tooltip and table value: signed gap (« +12,00 € »). */
  signed?: boolean;
}

const signed = (cents: number) => (cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents));

function SeriesKey({ series }: { series: StackSeries }) {
  if (series.type === "line") return <LegendKey series={series} />;
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-[3px]"
      style={
        series.outline
          ? { border: `2px solid ${series.color}`, background: "var(--card)" }
          : { background: series.color }
      }
    />
  );
}

export function StackTooltip({
  active,
  payload,
  label,
  series,
  signedValues,
}: TooltipContentProps & { series: StackSeries[]; signedValues: boolean }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  const rows = series.flatMap((s) => {
    const value = row?.[s.key];
    if (typeof value !== "number") return [];
    // A stacked segment at 0 carries nothing worth reading.
    if (s.stackId && value === 0) return [];
    return [{ s, cents: eurosToCents(value) }];
  });
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <ul className="flex flex-col gap-1">
        {[...rows].reverse().map(({ s, cents }) => (
          <li key={s.key} className="flex items-center gap-2">
            {s.tooltipOnly ? <span aria-hidden className="inline-block size-3 shrink-0" /> : <SeriesKey series={s} />}
            <span className="font-semibold tabular-nums">{signedValues || s.signed ? signed(cents) : formatEuros(cents)}</span>
            <span className="text-muted-foreground">{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Euro chart of bars and/or areas (stacked or side by side), with optional lines on top: an HTML
 * legend, a text alternative (role="img") and a data-table fallback, like `PlanLineChart`.
 * `horizontal` draws horizontal bars with the labels on the left (one row per category).
 */
export function PlanStackChart({
  data,
  series,
  summary,
  tableCaption,
  horizontal = false,
  zeroLine = false,
  signedValues = false,
  height,
  rowHeader,
  formatCell,
  legendNote,
}: {
  data: Row[];
  series: StackSeries[];
  summary: string;
  tableCaption: string;
  horizontal?: boolean;
  zeroLine?: boolean;
  /** Values are gaps: shown « +12,00 € » / « -3,50 € ». */
  signedValues?: boolean;
  /** Plot height in px; horizontal charts grow with their rows by default. */
  height?: number;
  rowHeader?: string;
  formatCell?: (value: Row[string] | undefined, key: string, row: Row) => string;
  /** Extra legend text (e.g. what the colours of a toned series mean). */
  legendNote?: ReactNode;
}) {
  const euros = (v: number) => formatEurosWhole(eurosToCents(v));
  const valueAxis = { tick: { fill: MUTED, fontSize: 12 }, tickLine: false, tickFormatter: euros } as const;
  const categoryAxis = { dataKey: "label", tick: { fill: MUTED, fontSize: 12 }, tickLine: false } as const;
  const plotHeight = height ?? (horizontal ? Math.max(160, data.length * 2 * 18 + 48) : 256);
  const stacked = series.some((s) => s.stackId);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Légende">
        {series.filter((s) => !s.tooltipOnly).map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <SeriesKey series={s} />
            {s.name}
          </li>
        ))}
        {legendNote ? <li>{legendNote}</li> : null}
      </ul>

      <div role="img" aria-label={summary} className="w-full" style={{ height: plotHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            stackOffset={stacked ? "sign" : undefined}
            barGap={2}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--divider)" />
            {horizontal ? (
              <>
                <XAxis type="number" {...valueAxis} axisLine={false} />
                <YAxis type="category" {...categoryAxis} width={128} axisLine={{ stroke: "var(--border)" }} interval={0} />
              </>
            ) : (
              <>
                <XAxis {...categoryAxis} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis width={76} {...valueAxis} axisLine={false} />
              </>
            )}
            {zeroLine ? (
              <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke="var(--muted-foreground)" />
            ) : null}
            <Tooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
              content={(props) => <StackTooltip {...props} series={series} signedValues={signedValues} />}
            />
            {series.filter((s) => !s.tooltipOnly).map((s) => {
              if (s.type === "line") {
                return (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    strokeDasharray={s.dashed ? "6 4" : undefined}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                );
              }
              if (s.type === "area") {
                return (
                  <Area
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stackId={s.stackId}
                    fill={s.color}
                    fillOpacity={0.85}
                    // Surface-coloured edge: a visible gap between stacked bands.
                    stroke="var(--card)"
                    strokeWidth={2}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                );
              }
              const radius: [number, number, number, number] = s.stackId ? [0, 0, 0, 0] : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  stackId={s.stackId}
                  fill={s.outline ? "var(--card)" : s.color}
                  stroke={s.outline ? s.color : "var(--card)"}
                  strokeWidth={s.outline ? 2 : 1}
                  radius={radius}
                  maxBarSize={horizontal ? 14 : 28}
                  isAnimationActive={false}
                >
                  {s.fillFor
                    ? data.map((row) => {
                        const tone = s.fillFor!(row) ?? s.color;
                        return <Cell key={row.label} fill={s.outline ? "var(--card)" : tone} stroke={s.outline ? tone : "var(--card)"} />;
                      })
                    : null}
                </Bar>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ChartDataTable
        data={data}
        columns={series}
        caption={tableCaption}
        rowHeader={rowHeader}
        format={
          formatCell ??
          ((value, key) => {
            if (typeof value !== "number") return "—";
            const cents = eurosToCents(value);
            return signedValues || series.find((s) => s.key === key)?.signed ? signed(cents) : formatEuros(cents);
          })
        }
      />
    </div>
  );
}
