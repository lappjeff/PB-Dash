import type { Metadata } from "next";
import Link from "next/link";
import { pageContext } from "@/server/page";
import { resolveScope } from "@/server/authz";
import { parseFilters } from "@/server/metrics/filters";
import { getKpis, METRIC_DEFINITIONS } from "@/server/metrics/sales";
import { getOpenActivities, getPriorityQueue, RULE_DESCRIPTIONS } from "@/server/metrics/priority";
import { listOpportunities, listParamsSchema } from "@/server/metrics/opportunities";
import { targetForMonth } from "@/server/metrics/analytics";
import { KpiCard, PageHeader, Section } from "@/components/kpi-card";
import { ActivityQueue, PriorityQueue } from "@/components/activity-queue";
import { NotLinked } from "@/components/pages/forbidden";
import { StatusBadge } from "@/components/opportunity-table";
import { formatCents } from "@/lib/money";
import { formatCount, formatPercent, formatRelative, pluralize } from "@/lib/format";
import { monthBounds, todayLocal } from "@/lib/time";

export const metadata: Metadata = { title: "My Dashboard" };

export default async function MyDashboardPage() {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (viewer.salespersonId === null) return <NotLinked />;
  const scope = resolveScope(viewer, [viewer.salespersonId]);
  const opts = { includeArchived: thresholds.includeArchivedInClosed };
  const month = parseFilters({ preset: "mtd" }, tz);
  const year = parseFilters({ preset: "last-12m" }, tz);
  const { start, end } = monthBounds(todayLocal(tz));

  const [mtd, last12, queue, upcoming, recent, target] = await Promise.all([
    getKpis(db, month, scope, opts),
    getKpis(db, year, scope, opts),
    getPriorityQueue(db, scope, thresholds),
    getOpenActivities(db, scope, { horizonDays: 14, limit: 12 }),
    listOpportunities(db, listParamsSchema.parse({ sort: "changed", dir: "desc", pageSize: "10" }), scope, tz),
    targetForMonth(db, scope, start, end),
  ]);
  const progress = target ? mtd.won.valueCents / target : null;
  const coverage = target ? mtd.open.valueCents / target : null;

  return (
    <>
      <PageHeader title={`Hi, ${viewer.name.split(" ")[0]}`} description={`Your Precise Builder opportunities. Month to date: ${month.from} to ${month.to}.`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Won Sales this month" value={formatCents(mtd.won.valueCents, { compact: true })} note={pluralize(mtd.won.count, "deal")} definition={METRIC_DEFINITIONS.wonSales} href={`/opportunities?status=won&closedFrom=${month.from}&closedTo=${month.to}`} />
        <KpiCard label="Open pipeline" value={formatCents(mtd.open.valueCents, { compact: true })} note={coverage !== null ? `${coverage.toFixed(1)}× this month's target` : undefined} definition={METRIC_DEFINITIONS.openPipeline} href="/opportunities?status=open" />
        <KpiCard label="Active opportunities" value={formatCount(mtd.open.count)} href="/opportunities?status=open" />
        <KpiCard label="Win rate (12 mo)" value={formatPercent(last12.winRate)} note={`${last12.won.count} won / ${last12.won.count + last12.lost.count} closed`} definition={METRIC_DEFINITIONS.winRate} />
        <div className="col-span-2 md:col-span-1">
          <TargetCard target={target} won={mtd.won.valueCents} progress={progress} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Section title="Needs attention" description="Each item shows the rule that flagged it" className="lg:col-span-3" definition={Object.values(RULE_DESCRIPTIONS).join(" ")}>
          <PriorityQueue items={queue} limit={10} />
        </Section>
        <Section title="Upcoming activities" description="Open PB activities due in the next 14 days, and anything overdue" className="lg:col-span-2">
          <ActivityQueue items={upcoming} tz={tz} />
        </Section>
      </div>

      <Section title="Recently changed opportunities" description="Ordered by the last change this app observed in PB" className="mt-4">
        <ul className="divide-y">
          {recent.rows.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <Link href={`/opportunities/${o.id}`} className="truncate text-sm font-medium hover:underline">
                  {o.name}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {[o.customerName, o.stageName].filter(Boolean).join(" · ")} · {o.lastChangedAt ? `changed ${formatRelative(o.lastChangedAt)}` : "no change observed yet"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm tabular">{formatCents(o.valueCents)}</span>
                <StatusBadge status={o.status} />
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function TargetCard({ target, won, progress }: { target: number | null; won: number; progress: number | null }) {
  if (target === null) {
    return <KpiCard label="Monthly target" value="Not set" note="An administrator can set targets in Settings." />;
  }
  const pct = Math.min(1, progress ?? 0);
  return (
    <div className="h-full rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">Progress to monthly target</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{formatPercent(progress, 0)}</div>
      <div className="mt-2 h-2 rounded-full bg-[var(--viz-seq-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label="Progress to monthly target">
        <div className="h-2 rounded-full bg-[var(--viz-series-1)]" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground tabular">
        {formatCents(won, { compact: true })} of {formatCents(target, { compact: true })}
      </div>
    </div>
  );
}
