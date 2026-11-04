import type { Metadata } from "next";
import { pageContext } from "@/server/page";
import { isAdmin } from "@/server/authz";
import { parseFilters, type SearchParams } from "@/server/metrics/filters";
import { getSalespersonScorecard } from "@/server/metrics/sales";
import { getFilterOptions } from "@/server/metrics/opportunities";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHeader, Section } from "@/components/kpi-card";
import { SalesLeaderboard } from "@/components/sales-leaderboard";
import { Forbidden } from "@/components/pages/forbidden";
import { toLeaderRow } from "@/components/pages/leader-row";

export const metadata: Metadata = { title: "Salespeople" };

export default async function SalespeoplePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (!isAdmin(viewer)) return <Forbidden />;
  const raw = await searchParams;
  const f = parseFilters(raw, tz);
  const [rows, options] = await Promise.all([
    getSalespersonScorecard(db, f, "all", { includeArchived: thresholds.includeArchivedInClosed }),
    getFilterOptions(db, "all"),
  ]);
  const q = new URLSearchParams(Object.entries(raw).filter(([k, v]) => typeof v === "string" && ["preset", "from", "to"].includes(k)) as [string, string][]);
  return (
    <>
      <PageHeader title="Team performance" description={`Closed ${f.from} to ${f.to}. Open pipeline and overdue activities are current.`} />
      <div className="mb-4">
        <FilterBar from={f.from} to={f.to} preset={f.preset} stages={options.stages} jobTypes={options.jobTypes} leadSources={options.leadSources} />
      </div>
      <Section title="Scorecard" description="Select a salesperson for detail. Median cycle = created → won, in days.">
        <SalesLeaderboard rows={rows.map(toLeaderRow)} extended hrefBase="/salespeople/" hrefSuffix={q.size ? `?${q}` : ""} />
      </Section>
    </>
  );
}
