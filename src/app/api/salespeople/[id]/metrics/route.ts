import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { apiError, handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { resolveScope } from "@/server/authz";
import { parseFilters } from "@/server/metrics/filters";
import { getKpis, getPipelineByStage, getTrend } from "@/server/metrics/sales";
import { activitySummary } from "@/server/metrics/analytics";
import { getThresholds } from "@/server/settings";

/** Admins: any salesperson. Salespeople: only themselves (403 otherwise). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return apiError(400, "invalid-id", "Invalid salesperson id");
  const scope = resolveScope(viewer, [id]);
  const db = await getDb();
  const f = parseFilters(searchParamsObject(req.url), companyTimezone());
  const t = await getThresholds(db);
  const opts = { includeArchived: t.includeArchivedInClosed };
  const [kpis, pipeline, trend, activities] = await Promise.all([getKpis(db, f, scope, opts), getPipelineByStage(db, f, scope), getTrend(db, f, scope, opts), activitySummary(db, f, scope)]);
  return NextResponse.json({ salespersonId: id, filters: { from: f.from, to: f.to }, kpis, pipeline, trend, activities });
});
