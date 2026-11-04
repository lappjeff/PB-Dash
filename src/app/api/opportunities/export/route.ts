import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { handle, searchParamsObject } from "@/server/api";
import { requireViewer } from "@/server/auth";
import { resolveScope } from "@/server/authz";
import { iterateOpportunities, listParamsSchema } from "@/server/metrics/opportunities";
import { csvCell } from "@/lib/csv";

export const maxDuration = 60;

/** CSV of the opportunities the viewer may see, with the current filters. No contact details. */
export const GET = handle(async (req: Request) => {
  const viewer = await requireViewer();
  const p = listParamsSchema.parse(searchParamsObject(req.url));
  const scope = resolveScope(viewer, p.sp.length ? p.sp : null);
  const db = await getDb();
  const tz = companyTimezone();
  const header = ["Job #", "Opportunity", "Customer", "Salesperson", "Stage", "Status", "Archived", "Value (USD)", "Job type", "Lead source", "Created", "Closed at", "Last change observed", "Last synced"];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(header.join(",") + "\n"));
      for await (const r of iterateOpportunities(db, p, scope, tz)) {
        const dollars = r.valueCents === null ? null : `${r.valueCents < 0 ? "-" : ""}${Math.trunc(Math.abs(r.valueCents) / 100)}.${String(Math.abs(r.valueCents % 100)).padStart(2, "0")}`;
        const line = [r.number, r.name, r.customerName, r.salespersonName, r.stageName, r.status, r.archived ? "yes" : "no", dollars, r.jobTypeName, r.leadSourceName, r.createdDate, r.closedAt, r.lastChangedAt, r.lastSyncedAt];
        controller.enqueue(enc.encode(line.map(csvCell).join(",") + "\n"));
      }
      controller.close();
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="opportunities-${date}.csv"`, "Cache-Control": "no-store" },
  });
});
