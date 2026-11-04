import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { requireAdmin, resolveScope } from "@/server/authz";
import { parseFilters } from "@/server/metrics/filters";
import { salesByJobType, salesByLeadSource, salesCycle, stageAging, transitionHistory } from "@/server/metrics/analytics";
import { getTrend } from "@/server/metrics/sales";
import { getThresholds } from "@/server/settings";

export const GET = handle(async (req: Request) => {
  const viewer = await requireViewer();
  requireAdmin(viewer);
  const db = await getDb();
  const f = parseFilters(searchParamsObject(req.url), companyTimezone(), "last-12m");
  const scope = resolveScope(viewer, f.salespersonIds);
  const a = (await getThresholds(db)).includeArchivedInClosed;
  const [byJobType, byLeadSource, wonVsLost, cycle, aging, history] = await Promise.all([
    salesByJobType(db, f, scope, a),
    salesByLeadSource(db, f, scope, a),
    getTrend(db, f, scope, { includeArchived: a }),
    salesCycle(db, f, scope, a),
    stageAging(db, f, scope),
    transitionHistory(db, scope),
  ]);
  return NextResponse.json({ filters: { from: f.from, to: f.to }, byJobType, byLeadSource, wonVsLost, salesCycle: cycle, stageAging: aging, stageHistory: history });
});
