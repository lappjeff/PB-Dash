import type { Metadata } from "next";
import { pageContext } from "@/server/page";
import { isAdmin, resolveScope } from "@/server/authz";
import { parseFilters, type SearchParams } from "@/server/metrics/filters";
import { getKpis, getPipelineByStage, getSalespersonScorecard, getTrend, METRIC_DEFINITIONS } from "@/server/metrics/sales";
import { getFilterOptions } from "@/server/metrics/opportunities";
import { getPriorityQueue } from "@/server/metrics/priority";
import { FilterBar } from "@/components/filters/filter-bar";
import { KpiCard, PageHeader, Section } from "@/components/kpi-card";
import { PipelineChart } from "@/components/charts/pipeline-chart";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { SalesLeaderboard } from "@/components/sales-leaderboard";
import { PriorityQueue } from "@/components/activity-queue";
import { Forbidden } from "@/components/pages/forbidden";
import { DataNotes } from "@/components/pages/data-notes";
import { formatCents } from "@/lib/money";
import { formatCount, formatPercent, pluralize } from "@/lib/format";
import { opportunitiesLink } from "@/lib/links";
import { toLeaderRow } from "@/components/pages/leader-row";

export const metadata: Metadata = { title: "Overview" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (!isAdmin(viewer)) return <Forbidden />;
  const f = parseFilters(await searchParams, tz);
  const scope = resolveScope(viewer, f.salespersonIds);
  const opts = { includeArchived: thresholds.includeArchivedInClosed };

  const [kpis, pipeline, trend, board, options, queue] = await Promise.all([
    getKpis(db, f, scope, opts),
    getPipelineByStage(db, f, scope),
    getTrend(db, f, scope, opts),
    getSalespersonScorecard(db, f, scope, opts),
    getFilterOptions(db, "all"),
    getPriorityQueue(db, scope, thresholds),
  ]);
  const closed = { closedFrom: f.from, closedTo: f.to };
  const link = (extra: Record<string, string>) => opportunitiesLink(f, extra);

  return (
    <>
      <PageHeader
        title="Company overview"
        description={
          <>
            Won and lost counted by close date, {f.from} to {f.to} ({tz}). Open pipeline is the current state.
          </>
        }
      />
      <div className="mb-5">
        <FilterBar from={f.from} to={f.to} preset={f.preset} salespeople={options.salespeople} stages={options.stages} jobTypes={options.jobTypes} leadSources={options.leadSources} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Open pipeline" value={formatCents(kpis.open.valueCents, { compact: true })} note={missingNote(kpis.open.missingValue)} definition={METRIC_DEFINITIONS.openPipeline} href={link({ status: "open" })} />
        <KpiCard label="Won Sales" value={formatCents(kpis.won.valueCents, { compact: true })} note={`${pluralize(kpis.won.count, "deal")}${kpis.won.missingValue ? ` · ${kpis.won.missingValue} w/o value` : ""}`} definition={METRIC_DEFINITIONS.wonSales} href={link({ status: "won", ...closed })} />
        <KpiCard label="Lost value" value={formatCents(kpis.lost.valueCents, { compact: true })} note={pluralize(kpis.lost.count, "opportunity", "opportunities")} definition={METRIC_DEFINITIONS.lostValue} href={link({ status: "lost", ...closed })} />
        <KpiCard label="Active opportunities" value={formatCount(kpis.open.count)} definition={METRIC_DEFINITIONS.activeOpportunities} href={link({ status: "open" })} />
        <KpiCard label="Avg won deal" value={formatCents(kpis.avgWonCents, { compact: true })} note={kpis.medianCycleDays !== null ? `Median cycle ${kpis.medianCycleDays}d` : undefined} definition={METRIC_DEFINITIONS.avgWonDeal} />
        <KpiCard label="Win rate" value={formatPercent(kpis.winRate)} note={`${kpis.won.count} won / ${kpis.won.count + kpis.lost.count} closed`} definition={METRIC_DEFINITIONS.winRate} />
        <KpiCard label="Needs attention" value={formatCount(queue.length)} tone={queue.length ? "warning" : undefined} definition={METRIC_DEFINITIONS.needsAttention} href="#attention" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Section title="Open pipeline by stage" description="Click a stage to see its opportunities" className="lg:col-span-2" definition={METRIC_DEFINITIONS.openPipeline}>
          <PipelineChart stages={pipeline} linkBase={link({ status: "open" })} />
        </Section>
        <Section title="Won Sales over time" description="By close date. Click a period to list the deals." className="lg:col-span-3" definition={METRIC_DEFINITIONS.wonSales}>
          <RevenueTrendChart points={trend} group={f.groupBy} opportunitiesHref={link({})} />
        </Section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Section title="Sales leaderboard" description="Won and win rate in the selected range; open pipeline is current" className="xl:col-span-3">
          <SalesLeaderboard rows={board.map(toLeaderRow)} hrefBase="/salespeople/" />
        </Section>
        <Section title="Needs attention" description="Open opportunities flagged by the action rules" className="xl:col-span-2">
          <div id="attention">
            <PriorityQueue items={queue} limit={8} showOwner />
          </div>
        </Section>
      </div>

      <DataNotes kpis={kpis} />
    </>
  );
}

function missingNote(n: number) {
  return n ? `${n} without a value (excluded)` : undefined;
}
