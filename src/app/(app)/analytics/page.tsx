import type { Metadata } from "next";
import { pageContext } from "@/server/page";
import { isAdmin, resolveScope } from "@/server/authz";
import { parseFilters, type SearchParams } from "@/server/metrics/filters";
import { getTrend, METRIC_DEFINITIONS } from "@/server/metrics/sales";
import { MIN_TRANSITIONS_FOR_HISTORY, salesByJobType, salesByLeadSource, salesCycle, stageAging, transitionHistory } from "@/server/metrics/analytics";
import { getFilterOptions } from "@/server/metrics/opportunities";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHeader, Section } from "@/components/kpi-card";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { AgingHeatmap, SimpleColumns } from "@/components/charts/simple-bars";
import { BreakdownTable } from "@/components/pages/breakdown-table";
import { Forbidden } from "@/components/pages/forbidden";
import { opportunitiesLink } from "@/lib/links";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (!isAdmin(viewer)) return <Forbidden />;
  const f = parseFilters(await searchParams, tz, "last-12m");
  const scope = resolveScope(viewer, f.salespersonIds);
  const a = thresholds.includeArchivedInClosed;
  const [options, jobTypes, sources, trend, cycle, aging, history] = await Promise.all([
    getFilterOptions(db, "all"),
    salesByJobType(db, f, scope, a),
    salesByLeadSource(db, f, scope, a),
    getTrend(db, f, scope, { includeArchived: a }),
    salesCycle(db, f, scope, a),
    stageAging(db, f, scope),
    transitionHistory(db, scope),
  ]);
  const unknownAging = aging.stages.reduce((s, st) => s + aging.cell[st]["Unknown"].count, 0);
  const totalAging = aging.stages.reduce((s, st) => s + aging.buckets.reduce((t, b) => t + aging.cell[st][b].count, 0), 0);

  return (
    <>
      <PageHeader title="Analytics" description={`${f.from} to ${f.to} (${tz})`} />
      <div className="mb-5">
        <FilterBar from={f.from} to={f.to} preset={f.preset} salespeople={options.salespeople} stages={options.stages} jobTypes={options.jobTypes} leadSources={options.leadSources} />
      </div>

      <div className="grid gap-4">
        <Section title="Won versus lost" description="Value by close period. Click a column to list those opportunities." definition={`${METRIC_DEFINITIONS.wonSales} ${METRIC_DEFINITIONS.lostValue}`}>
          <RevenueTrendChart points={trend} group={f.groupBy} showLost opportunitiesHref={opportunitiesLink(f)} height={300} />
        </Section>

        <Section title="Sales by job type" description="Created = opportunities created in range. Won, win rate and average use close date in range.">
          <BreakdownTable rows={jobTypes} dimension="Job type" />
        </Section>

        <Section title="Sales by lead source" description="Lead source is on the PB customer. Cohort conversion = share of opportunities created in range that are won so far.">
          <BreakdownTable rows={sources} dimension="Lead source" />
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Sales cycle" description={`Created → won, for ${cycle.n} won opportunities closed in range`} definition={METRIC_DEFINITIONS.salesCycle}>
            <div className="mb-3 grid grid-cols-3 gap-3 text-center">
              {[
                ["25th pct", cycle.p25],
                ["Median", cycle.median],
                ["75th pct", cycle.p75],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg border p-2">
                  <div className="text-lg font-semibold tabular">{v === null ? "—" : `${v}d`}</div>
                  <div className="text-xs text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            <SimpleColumns labels={cycle.histogram.map((h) => h.label)} values={cycle.histogram.map((h) => h.count)} unit="won opportunities" ariaLabel="Distribution of sales cycle length" />
          </Section>

          <Section title="Stage aging" description="Open opportunities by time in their current stage" definition={METRIC_DEFINITIONS.stageAge}>
            <AgingHeatmap stages={aging.stages} buckets={aging.buckets} counts={aging.stages.map((s) => aging.buckets.map((b) => aging.cell[s][b].count))} />
            {unknownAging > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {unknownAging} of {totalAging} open opportunities show &ldquo;Unknown&rdquo;: no verified stage-change event has been received for their current stage yet. This shrinks as webhook history accumulates.
              </p>
            )}
          </Section>
        </div>

        <Section title="Historical stage analysis" description="Verified stage moves from opportunity.stage_updated webhooks">
          {history.total < MIN_TRANSITIONS_FOR_HISTORY ? (
            <p className="text-sm text-muted-foreground">
              Collecting history: {history.total} verified stage changes recorded{history.since ? ` since ${formatDateTime(history.since, tz)}` : ""}. This report appears after {MIN_TRANSITIONS_FOR_HISTORY}. Past stage moves are not reconstructed from current records.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {history.total} verified moves since {history.since ? formatDateTime(history.since, tz) : "—"}. Counts of moves, not conversion rates: opportunities that entered a stage before tracking began are not included.
              </p>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">From</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">To</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Moves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.rows.slice(0, 20).map((r) => (
                      <tr key={`${r.from}-${r.to}`} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{r.from}</td>
                        <td className="px-3 py-1.5">{r.to}</td>
                        <td className="px-3 py-1.5 text-right tabular">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      </div>
    </>
  );
}
