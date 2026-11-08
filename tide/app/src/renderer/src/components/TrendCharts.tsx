// The two stacked Trends graphs on the same time axis: Clarity index above, Species found below.
// One point per video, or (grouped) the mean per date with its min–max range. Only shows back-end numbers.
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendGroup, TrendPoint, Trends } from "../../../shared/api";
import type { Theme } from "../theme";
import { isGroup, TrendTooltip, type TrendRow } from "./TrendTooltip";

// Validated with the dataviz palette checks against each theme's surface.
const COLORS = {
  light: { clarity: "#008a9e", species: "#4a5fe0", grid: "#e3e8ee", axis: "#6b7785" },
  dark: { clarity: "#13a0ab", species: "#8a7cf0", grid: "#24323f", axis: "#8a98a8" },
};

type DotProps = { cx?: number | null; cy?: number | null; index?: number; payload?: TrendRow };

type ChartProps = {
  title: string;
  rows: TrendRow[];
  valueKey: string;
  range?: (g: TrendGroup) => [number | null, number | null];
  domain?: [number, number];
  color: string;
  grid: string;
  axis: string;
  onOpen: (p: TrendPoint) => void;
};

function TrendChart({ title, rows, valueKey, range, domain, color, grid, axis, onOpen }: ChartProps) {
  const axisStyle = { stroke: axis, fontSize: 12, tickLine: false, axisLine: false };
  // Filled points are full protocol windows; hollow ones are shorter and not comparable. The invisible
  // larger circle makes a point easier to hit. Grouped points stand for several videos, so they don't open one.
  const dot = (radius: number) => {
    const Dot = ({ cx, cy, index, payload }: DotProps) => {
      if (typeof cx !== "number" || typeof cy !== "number" || !payload) return <g key={index} />;
      const point = isGroup(payload) ? null : payload;
      const hollow = !!point?.shortWindow;
      return (
        <g
          key={index}
          onClick={point ? () => onOpen(point) : undefined}
          style={{ cursor: point ? "pointer" : "default" }}
        >
          <circle cx={cx} cy={cy} r={12} fill="transparent" />
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            strokeWidth={2}
            fill={hollow ? "var(--card)" : color}
            stroke={hollow ? color : "var(--card)"}
          />
        </g>
      );
    };
    return Dot;
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={rows} syncId="trends" margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={grid} />
          <XAxis
            dataKey="label"
            {...axisStyle}
            tickMargin={8}
            tickFormatter={(label: string) => label.slice(0, 10)}
            interval="preserveStartEnd"
            minTickGap={24}
            padding={{ left: 16, right: 16 }}
          />
          <YAxis {...axisStyle} domain={domain ?? [0, "auto"]} allowDecimals={false} width={44} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: axis, strokeWidth: 1 }} />
          {range && (
            <Area
              dataKey={(r: TrendGroup) => range(r)}
              stroke="none"
              fill={color}
              fillOpacity={0.15}
              isAnimationActive={false}
              activeDot={false}
              connectNulls={false}
            />
          )}
          <Line
            type="linear"
            dataKey={valueKey}
            stroke={color}
            strokeWidth={2}
            dot={dot(4)}
            activeDot={dot(6)}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendCharts({
  trends,
  grouped,
  theme,
  onOpen,
}: {
  trends: Trends;
  grouped: boolean;
  theme: Theme;
  onOpen: (surveyId: number, videoId: number) => void;
}) {
  const c = COLORS[theme];
  const rows: TrendRow[] = grouped ? trends.groups : trends.points;
  const shared = { rows, grid: c.grid, axis: c.axis, onOpen: (p: TrendPoint) => onOpen(p.surveyId, p.videoId) };
  const anyShort = trends.points.some((p) => p.shortWindow);
  return (
    <div className="space-y-4">
      <TrendChart
        {...shared}
        title="Clarity index (0–100, estimate)"
        valueKey={grouped ? "clarityMean" : "clarityIndex"}
        range={grouped ? (g) => [g.clarityMin, g.clarityMax] : undefined}
        domain={[0, 100]}
        color={c.clarity}
      />
      <TrendChart
        {...shared}
        title="Species found"
        valueKey={grouped ? "speciesMean" : "speciesFound"}
        range={grouped ? (g) => [g.speciesMin, g.speciesMax] : undefined}
        color={c.species}
      />
      <p className="text-xs text-muted-foreground">
        The clarity index is estimated from the pictures; it isn't a turbidity measurement, and light and depth affect
        it.{" "}
        {grouped ? "The band shows the lowest and highest video of each date. " : "Click a point to open that video. "}
        {!grouped &&
          anyShort &&
          "○ Hollow points are shorter than the protocol window: not comparable with full windows."}
      </p>
    </div>
  );
}
