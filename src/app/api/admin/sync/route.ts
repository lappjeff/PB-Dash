import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { requireAdmin } from "@/server/authz";
import { jobFullSync, jobProcessEvents, jobReconcile } from "@/server/jobs";

export const maxDuration = 300;

const body = z.object({ type: z.enum(["reconcile", "full", "process-events"]) });

export const POST = handle(async (req: Request) => {
  const viewer = await requireViewer();
  requireAdmin(viewer);
  const { type } = body.parse(await req.json().catch(() => ({})));
  if (type === "process-events") {
    const r = await jobProcessEvents();
    return NextResponse.json({ result: r, message: `Processed ${r.processed}, ignored ${r.ignored}, failed ${r.failed} of ${r.claimed} queued event(s).` });
  }
  if (type === "full") {
    const r = await jobFullSync("manual");
    return NextResponse.json({ result: r, message: `Full sync ${r.status}: ${r.recordsProcessed} records.${r.message ? ` ${r.message}` : ""}` }, { status: r.status === "failed" ? 502 : 200 });
  }
  const r = await jobReconcile("manual");
  return NextResponse.json(
    { result: r, message: `Reconciliation ${r.sync.status}: ${r.sync.recordsProcessed} records.${r.sync.message ? ` ${r.sync.message}` : ""}` },
    { status: r.sync.status === "failed" ? 502 : 200 },
  );
});
