import type { Metadata } from "next";
import { pageContext } from "@/server/page";
import { isAdmin, resolveScope } from "@/server/authz";
import { first, type SearchParams } from "@/server/metrics/filters";
import { getFilterOptions, listOpportunities, listParamsSchema } from "@/server/metrics/opportunities";
import { FilterBar } from "@/components/filters/filter-bar";
import { PageHeader } from "@/components/kpi-card";
import { OpportunityTable } from "@/components/opportunity-table";
import { NotLinked } from "@/components/pages/forbidden";
import { StatusFilter } from "@/components/filters/status-filter";

export const metadata: Metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, db, tz } = await pageContext();
  if (!isAdmin(viewer) && viewer.salespersonId === null) return <NotLinked />;
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, first(v)]));
  const p = listParamsSchema.parse(flat);
  const scope = isAdmin(viewer) ? resolveScope(viewer, p.sp) : resolveScope(viewer, null);
  const [result, options] = await Promise.all([listOpportunities(db, p, scope, tz), getFilterOptions(db, scope)]);
  const exportQuery = new URLSearchParams(Object.entries(flat).filter(([k, v]) => v && k !== "page") as [string, string][]);

  return (
    <>
      <PageHeader
        title="Opportunities"
        description={
          p.closedFrom && p.closedTo
            ? `Closed ${p.closedFrom} to ${p.closedTo}`
            : isAdmin(viewer)
              ? "Every synced Precise Builder opportunity"
              : "Your Precise Builder opportunities"
        }
      />
      <div className="mb-4 flex flex-wrap items-start gap-2">
        <StatusFilter value={p.status ?? null} />
        <FilterBar
          from=""
          to=""
          preset={null}
          showDate={false}
          salespeople={isAdmin(viewer) ? options.salespeople : undefined}
          stages={options.stages}
          jobTypes={options.jobTypes}
          leadSources={options.leadSources}
        />
      </div>
      <OpportunityTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        sort={p.sort}
        dir={p.dir}
        exportHref={`/api/opportunities/export?${exportQuery.toString()}`}
        hideColumns={isAdmin(viewer) ? [] : ["salesperson"]}
      />
    </>
  );
}
