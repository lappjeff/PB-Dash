import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { handle } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { requireAdmin } from "@/server/authz";
import { getSyncStatus } from "@/server/metrics/analytics";

export const GET = handle(async () => {
  requireAdmin(await requireViewer());
  return NextResponse.json(await getSyncStatus(await getDb()));
});
