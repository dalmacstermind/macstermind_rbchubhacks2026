// Trends across surveys: water clarity and a second measure on the same timeline, so a drop in
// species can be checked against murkier water. One point per survey, by date filmed.
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { SurveyOverview } from "../overview";
import type { Theme } from "../theme";
import { Chip, Disclosure, Header, btnGhost, btnLink, plural } from "../ui";
import { EditSurvey } from "./Report";

type Metric = "species" | "fish" | "invasive";
const METRIC: Record<Metric, string> = {
  species: "Fish species found",
  fish: "Fish counted (MaxN)",
  invasive: "Invasive fish & crabs",
};

// Validated with the dataviz palette checks against each theme's surface.
const COLORS = {
  light: { clarity: "#008a9e", metric: "#4a5fe0", grid: "#e3e8ee", axis: "#6b7785" },
  dark: { clarity: "#13a0ab", metric: "#8a7cf0", grid: "#24323f", axis: "#8a98a8" },
};

type Point = {
  key: number;
  label: string;
  date: string;
  site: string;
  clarity: number | null;
  species: number;
  fish: number;
  invasive: number;
  checked: boolean;
};

export function TrendsView({
  overview,
  theme,
  onOpen,
  onChanged,
}: {
  overview: SurveyOverview[] | null;
  theme: Theme;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const [site, setSite] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [metric, setMetric] = useState<Metric>("species");
  const [table, setTable] = useState(false);
  const [editing, setEditing] = useState<SurveyOverview | null>(null);
  const c = COLORS[theme];

  const sites = useMemo(() => [...new Set((overview ?? []).map((o) => o.data.survey.site))].sort(), [overview]);
  const inScope = (overview ?? []).filter(
    (o) =>
      (site === "all" || o.data.survey.site === site) &&
      (!checkedOnly || (o.summary.toReview === 0 && o.summary.toLabel === 0)),
  );
  const undated = inScope.filter((o) => !o.data.survey.surveyDate);
  const points: Point[] = inScope
    .filter(
      (o) =>
        o.data.survey.surveyDate &&
        (!from || o.data.survey.surveyDate >= from) &&
        (!to || o.data.survey.surveyDate <= to),
    )
    .sort((a, b) => a.data.survey.surveyDate.localeCompare(b.data.survey.surveyDate))
    .map((o) => ({
      key: o.data.survey.id,
      label: o.data.survey.surveyDate,
      date: o.data.survey.surveyDate,
      site: o.data.survey.site,
      clarity: o.summary.clarity === null ? null : Math.round(o.summary.clarity),
      species: o.summary.speciesCount,
      fish: o.summary.total,
      invasive: o.summary.invasive,
      checked: o.summary.toReview === 0 && o.summary.toLabel === 0,
    }));
  const hasClarity = points.some((p) => p.clarity !== null);

  const axis = { stroke: c.axis, fontSize: 12, tickLine: false, axisLine: false };
  const chart = (title: string, dataKey: "clarity" | Metric, color: string, domain?: [number, number]) => (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} syncId="trends" margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis
            dataKey="label"
            {...axis}
            tickMargin={8}
            interval="preserveStartEnd"
            minTickGap={24}
            padding={{ left: 16, right: 16 }}
          />
          <YAxis {...axis} domain={domain ?? [0, "auto"]} allowDecimals={false} width={44} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: c.axis, strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, fill: color, stroke: "var(--card)" }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--card)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <>
      {editing && <EditSurvey data={editing.data} onClose={() => setEditing(null)} onSaved={onChanged} />}
      <Header eyebrow="Tools" title="Trends">
        <button className={btnGhost} onClick={() => setTable(!table)}>
          {table ? "Show charts" : "Show as table"}
        </button>
      </Header>
      <div className="space-y-5 px-10 py-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select className="input w-auto" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <label className="flex items-center gap-2">
            From <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            to <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary"
              checked={checkedOnly}
              onChange={(e) => setCheckedOnly(e.target.checked)}
            />
            Only fully checked surveys
          </label>
        </div>

        {!overview ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : points.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
            No surveys with a date filmed match these filters.
            {undated.length > 0 && " Add dates to the surveys below to see them here."}
          </div>
        ) : table ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Date filmed</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3">Water clarity</th>
                  <th className="px-5 py-3">Fish species</th>
                  <th className="px-5 py-3">Fish counted</th>
                  <th className="px-5 py-3">Invasive</th>
                  <th className="px-5 py-3">Checked</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.key} className="border-t border-border">
                    <td className="px-5 py-2.5">{p.date}</td>
                    <td className="px-5 py-2.5">
                      <button className={btnLink} onClick={() => onOpen(p.key)}>
                        {p.site}
                      </button>
                    </td>
                    <td className="px-5 py-2.5">{p.clarity ?? "—"}</td>
                    <td className="px-5 py-2.5">{p.species}</td>
                    <td className="px-5 py-2.5">{p.fish}</td>
                    <td className="px-5 py-2.5">{p.invasive}</td>
                    <td className="px-5 py-2.5">
                      {p.checked ? <Chip tone="done">Yes</Chip> : <Chip tone="review">Not yet</Chip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            {hasClarity ? (
              chart("Water clarity (0–100, estimate)", "clarity", c.clarity, [0, 100])
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-5 py-4 text-sm text-muted-foreground">
                Water clarity isn't measured for these surveys yet.
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Compare with</span>
              <select
                className="input w-auto py-1.5"
                value={metric}
                onChange={(e) => setMetric(e.target.value as Metric)}
              >
                {(Object.keys(METRIC) as Metric[]).map((m) => (
                  <option key={m} value={m}>
                    {METRIC[m]}
                  </option>
                ))}
              </select>
            </div>
            {chart(METRIC[metric], metric, c.metric)}
            <p className="text-xs text-muted-foreground">
              Water clarity is estimated from the pictures; it isn't a turbidity measurement. Hover a point for details.
            </p>
          </div>
        )}

        {undated.length > 0 && (
          <Disclosure label={`${plural(undated.length, "survey")} with no date filmed (not shown)`}>
            <div className="rounded-2xl border border-border bg-card">
              {undated.map((o) => (
                <div
                  key={o.data.survey.id}
                  className="flex items-center justify-between border-b border-border px-5 py-2.5 text-sm last:border-0"
                >
                  <span>{o.data.survey.site}</span>
                  <button className={btnLink} onClick={() => setEditing(o)}>
                    Add date
                  </button>
                </div>
              ))}
            </div>
          </Disclosure>
        )}
      </div>
    </>
  );
}

function TrendTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const p = active && (payload?.[0]?.payload as Point | undefined);
  if (!p) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-semibold">
        {p.date} · {p.site}
      </div>
      <Row value={p.clarity === null ? "—" : `${p.clarity} / 100`} label="Water clarity" />
      <Row value={p.species} label="Fish species found" />
      <Row value={p.fish} label="Fish counted" />
      <Row value={p.invasive} label="Invasive" />
      <div className="mt-1 text-muted-foreground">{p.checked ? "✓ Fully checked" : "⚠ Not fully checked"}</div>
    </div>
  );
}

const Row = ({ value, label }: { value: string | number; label: string }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <b>{value}</b>
  </div>
);
