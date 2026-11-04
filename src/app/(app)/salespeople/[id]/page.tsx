import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { pageContext } from "@/server/page";
import { isAdmin, resolveScope } from "@/server/authz";
import { salespeople } from "@/db/schema";
import { parseFilters, type SearchParams } from "@/server/metrics/filters";
import { getKpis, getPipelineByStage, getTrend, METRIC_DEFINITIONS } from "@/server/metrics/sales";
import { activitySummary, salesByLeadSource } from "@/server/metrics/analytics";
import { listOpportunities, listParamsSchema } from "@/server/metrics/opportunities";
import { FilterBar } from "@/components/filters/filter-bar";
import { KpiCard, PageHeader, Section } from "@/components/kpi-card";
import { PipelineChart } from "@/components/charts/pipeline-chart";
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart";
import { OpportunityTable } from "@/components/opportunity-table";
import { Forbidden } from "@/components/pages/forbidden";
import { BreakdownTable } from "@/components/pages/breakdown-table";
import { formatCents } from "@/lib/money";
import { formatCount, formatPercent, pluralize } from "@/lib/format";

export const metadata: Metadata = { title: "Salesperson" };

export default async function SalespersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (!isAdmin(viewer)) return <Forbidden />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [sp] = await db.select().from(salespeople).where(eq(salespeople.id, id));
  if (!sp) notFound();

  const f = parseFilters(await searchParams, tz);
  const scope = resolveScope(viewer, [id]);
  const opts = { includeArchived: thresholds.includeArchivedInClosed };
  const [kpis, pipeline, trend, sources, acts, recent] = await Promise.all([
    getKpis(db, f, scope, opts),
    getPipelineByStage(db, f, scope),
    getTrend(db, f, scope, opts),
    salesByLeadSource(db, f, scope, opts.includeArchived),
    activitySummary(db, f, scope),
    listOpportunities(db, listParamsSchema.parse({ sort: "changed", dir: "desc", pageSize: "10" }), scope, tz),
  ]);

  return (
    <>
      <Link href="/salespeople" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Team
      </Link>
      <PageHeader title={sp.name} description={`${sp.active ? "Active sales rep" : "Not in PB's current sales-rep list"} · closed ${f.from} to ${f.to}`} />
      <div className="mb-4">
        <FilterBar from={f.from} to={f.to} preset={f.preset} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Won Sales" value={formatCents(kpis.won.valueCents, { compact: true })} note={pluralize(kpis.won.count, "deal")} definition={METRIC_DEFINITIONS.wonSales} href={`/opportunities?sp=${id}&status=won&closedFrom=${f.from}&closedTo=${f.to}`} />
        <KpiCard label="Lost value" value={formatCents(kpis.lost.valueCents, { compact: true })} note={pluralize(kpis.lost.count, "opportunity", "opportunities")} href={`/opportunities?sp=${id}&status=lost&closedFrom=${f.from}&closedTo=${f.to}`} />
        <KpiCard label="Open pipeline" value={formatCents(kpis.open.valueCents, { compact: true })} note={`${formatCount(kpis.open.count)} open`} href={`/opportunities?sp=${id}&status=open`} />
        <KpiCard label="Win rate" value={formatPercent(kpis.winRate)} definition={METRIC_DEFINITIONS.winRate} />
        <KpiCard label="Avg won deal" value={formatCents(kpis.avgWonCents, { compact: true })} definition={METRIC_DEFINITIONS.avgWonDeal} />
        <KpiCard label="Median sales cycle" value={kpis.medianCycleDays === null ? "—" : `${kpis.medianCycleDays} days`} definition={METRIC_DEFINITIONS.salesCycle} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Section title="Won vs lost over time" className="lg:col-span-3">
          <RevenueTrendChart points={trend} group={f.groupBy} showLost opportunitiesHref={`/opportunities?sp=${id}`} />
        </Section>
        <Section title="Open pipeline by stage" className="lg:col-span-2">
          <PipelineChart stages={pipeline} linkBase={`/opportunities?sp=${id}&status=open`} />
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Section title="Lead sources" description="Lead source comes from the PB customer record" className="lg:col-span-3">
          <BreakdownTable rows={sources} dimension="Lead source" />
        </Section>
        <Section title="Activity summary" description="Recorded PB activities on this person's opportunities" className="lg:col-span-2">
          <dl className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Open" value={acts.open} />
            <Stat label="Overdue" value={acts.overdue} warn={acts.overdue > 0} />
            <Stat label="Completed in range" value={acts.completed} />
          </dl>
          {acts.completedByType.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {acts.completedByType.map((t) => (
                <li key={t.type} className="flex justify-between capitalize">
                  <span className="text-muted-foreground">{t.type}</span>
                  <span className="tabular">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Only activities logged in PB are counted; contact outside PB is not visible here.</p>
        </Section>
      </div>

      <Section title="Recently changed opportunities" className="mt-4" action={<Link className="text-sm underline-offset-2 hover:underline" href={`/opportunities?sp=${id}`}>View all</Link>}>
        <OpportunityTable rows={recent.rows} total={recent.total} page={1} pageSize={recent.pageSize} sort="changed" dir="desc" hideColumns={["salesperson", "customer"]} compact />
      </Section>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dd className={`text-xl font-semibold tabular ${warn ? "text-status-critical" : ""}`}>{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
