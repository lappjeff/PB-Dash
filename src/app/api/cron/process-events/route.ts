import { NextResponse } from "next/server";
import { handle } from "@/server/api";
import { jobProcessEvents } from "@/server/jobs";
import { cronGuard } from "../_auth";

export const maxDuration = 300;

/** Vercel Cron target (see vercel.json). Requires Authorization: Bearer $CRON_SECRET. */
export const GET = handle(async (req: Request) => {
  const denied = cronGuard(req);
  if (denied) return denied;
  return NextResponse.json(await jobProcessEvents());
});
