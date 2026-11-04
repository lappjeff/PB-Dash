import type { Breakdown } from "@/server/metrics/analytics";
import { formatCents } from "@/lib/money";
import { formatPercent } from "@/lib/format";
import { EmptyState } from "@/components/kpi-card";

/** Job-type / lead-source comparison table. A table, because the reader compares four different measures per row. */
export function BreakdownTable({ rows, dimension }: { rows: Breakdown[]; dimension: string }) {
  if (!rows.length) return <EmptyState title="No data for this range" />;
  const max = Math.max(1, ...rows.map((r) => r.wonCents));
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{dimension}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Opportunities created in the range">Created</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Won Sales</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Won</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Won ÷ (won + lost) closed in range">Win rate</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Avg won</th>
            <th scope="col" className="px-3 py-2 text-right font-medium" title="Share of opportunities created in the range that are won so far. Recent cohorts are still maturing.">Cohort conv.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}`} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-3 py-2 text-right tabular">{r.created}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 shrink-0 rounded-full bg-[var(--viz-grid)]" aria-hidden>
                    <div className="h-2 rounded-full bg-[var(--viz-series-1)]" style={{ width: `${(r.wonCents / max) * 100}%` }} />
                  </div>
                  <span className="tabular">{formatCents(r.wonCents, { compact: true })}</span>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular">{r.wonCount}</td>
              <td className="px-3 py-2 text-right tabular">{formatPercent(r.winRate)}</td>
              <td className="px-3 py-2 text-right tabular">{formatCents(r.avgWonCents, { compact: true })}</td>
              <td className="px-3 py-2 text-right tabular">{formatPercent(r.cohortConversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
