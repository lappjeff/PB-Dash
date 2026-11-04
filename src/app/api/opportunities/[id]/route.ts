import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { apiError, handle } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { getOpportunityDetail } from "@/server/metrics/opportunities";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return apiError(400, "invalid-id", "Invalid opportunity id");
  const o = await getOpportunityDetail(await getDb(), id, viewer);
  // Not found and not authorized are indistinguishable on purpose.
  if (!o) return apiError(404, "not-found", "Opportunity not found");
  return NextResponse.json(o);
});
