import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { requireAdmin } from "@/server/authz";
import { parseFilters } from "@/server/metrics/filters";
import { getSalespersonScorecard } from "@/server/metrics/sales";
import { getThresholds } from "@/server/settings";

export const GET = handle(async (req: Request) => {
  requireAdmin(await requireViewer());
  const db = await getDb();
  const f = parseFilters(searchParamsObject(req.url), companyTimezone());
  const t = await getThresholds(db);
  return NextResponse.json({ filters: { from: f.from, to: f.to }, salespeople: await getSalespersonScorecard(db, f, "all", { includeArchived: t.includeArchivedInClosed }) });
});
