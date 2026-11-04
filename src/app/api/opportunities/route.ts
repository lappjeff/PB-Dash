import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { resolveScope } from "@/server/authz";
import { listOpportunities, listParamsSchema } from "@/server/metrics/opportunities";

export const GET = handle(async (req: Request) => {
  const viewer = await requireViewer();
  const p = listParamsSchema.parse(searchParamsObject(req.url));
  const scope = resolveScope(viewer, p.sp.length ? p.sp : null);
  return NextResponse.json(await listOpportunities(await getDb(), p, scope, companyTimezone()));
});
