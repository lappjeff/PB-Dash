import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { resolveScope } from "@/server/authz";
import { parseFilters } from "@/server/metrics/filters";
import { getKpis, getPipelineByStage, getSalespersonScorecard, getTrend } from "@/server/metrics/sales";
import { getThresholds } from "@/server/settings";

/** Dashboard aggregates. Salespeople are limited to their own data; requesting others is a 403. */
export const GET = handle(async (req: Request) => {
  const viewer = await requireViewer();
  const db = await getDb();
  const f = parseFilters(searchParamsObject(req.url), companyTimezone());
  const scope = resolveScope(viewer, f.salespersonIds.length ? f.salespersonIds : null);
  const t = await getThresholds(db);
  const opts = { includeArchived: t.includeArchivedInClosed };
  const [kpis, pipeline, trend, leaderboard] = await Promise.all([
    getKpis(db, f, scope, opts),
    getPipelineByStage(db, f, scope),
    getTrend(db, f, scope, opts),
    getSalespersonScorecard(db, f, scope, opts),
  ]);
  return NextResponse.json({ filters: { from: f.from, to: f.to, timezone: f.tz, groupBy: f.groupBy }, kpis, pipeline, trend, leaderboard });
});
