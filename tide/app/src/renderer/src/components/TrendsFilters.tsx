// The filters above the Trends graphs: Transect, STAT, date range, reviewed only, group by survey date.
import type { TrendsQuery } from "../../../shared/api";

export function TrendsFilters({
  query,
  onChange,
  transects,
  stats,
}: {
  query: TrendsQuery;
  onChange: (q: TrendsQuery) => void;
  transects: string[];
  stats: string[];
}) {
  const set = (patch: Partial<TrendsQuery>) => onChange({ ...query, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <select
        className="input w-auto"
        value={query.transect}
        onChange={(e) => set({ transect: e.target.value })}
        aria-label="Transect"
      >
        <option value="">All Transects</option>
        {transects.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <select
        className="input w-auto"
        value={query.stat}
        onChange={(e) => set({ stat: e.target.value })}
        aria-label="STAT"
      >
        <option value="">All STATs</option>
        {stats.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <label className="flex items-center gap-2">
        From{" "}
        <input
          type="date"
          className="input w-auto"
          value={query.from}
          onChange={(e) => set({ from: e.target.value })}
        />
      </label>
      <label className="flex items-center gap-2">
        to <input type="date" className="input w-auto" value={query.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={query.reviewedOnly}
          onChange={(e) => set({ reviewedOnly: e.target.checked })}
        />
        Reviewed only
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="accent-primary"
          checked={query.groupBySurvey}
          onChange={(e) => set({ groupBySurvey: e.target.checked })}
        />
        Group by survey date
      </label>
    </div>
  );
}
