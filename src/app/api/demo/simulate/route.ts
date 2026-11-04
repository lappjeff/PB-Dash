import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { appMode } from "@/env";
import { apiError, handle } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { requireAdmin } from "@/server/authz";
import { simulateStageChanges } from "@/server/demo/simulate";

/** DEMO ONLY: move fixture opportunities and deliver signed webhooks through the real pipeline. */
export const POST = handle(async (req: Request) => {
  if (appMode() !== "demo") return apiError(404, "not-found", "Not found");
  requireAdmin(await requireViewer());
  const { count } = z.object({ count: z.number().int().min(1).max(50) }).parse(await req.json());
  const n = await simulateStageChanges(await getDb(), count);
  return NextResponse.json({ message: `Delivered ${n} signed opportunity.stage_updated webhook(s) and processed them.` });
});
