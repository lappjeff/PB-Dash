import type { Db } from "@/db";
import { getDemoPbClient } from "@/server/pb";
import { signPreciseBody } from "@/server/pb/signature";
import { ingestWebhook } from "@/server/webhooks/ingest";
import { processPendingEvents } from "@/server/webhooks/process";
import { companyTimezone } from "@/env";
import { DEMO_WEBHOOK_SECRET } from "./constants";
import crypto from "node:crypto";

/**
 * DEMO ONLY. Moves fixture opportunities forward one stage inside the fake PB, then
 * sends a correctly signed opportunity.stage_updated webhook for each through the real
 * ingest and processing pipeline.
 */
export async function simulateStageChanges(db: Db, count: number, opts: { spreadDays?: number } = {}) {
  const client = getDemoPbClient();
  if (!client) throw new Error("Demo PB client not initialised");
  const stages = client.data.salesStages;
  const open = client.data.opportunities.filter((o) => o.status === "pending" && !o.archived);
  const results: string[] = [];

  for (let i = 0; i < count && open.length; i++) {
    const opp = open.splice(Math.floor(Math.random() * open.length), 1)[0];
    const idx = stages.findIndex((s) => s.id === opp.sales_stage?.id);
    // Mostly advance; sometimes win or lose from Negotiation.
    let nextIdx = Math.min(idx + 1, 4);
    if (idx >= 3 && Math.random() < 0.5) nextIdx = Math.random() < 0.55 ? 5 : 6;
    if (nextIdx === idx) continue;
    const prev = stages[idx];
    const next = stages[nextIdx];
    const at = new Date(Date.now() - (opts.spreadDays ? Math.random() * opts.spreadDays * 86_400_000 : 0));

    opp.sales_stage = { id: next.id, name: next.name };
    opp.status = next.status ?? "pending";
    if (opp.status !== "pending") opp.closed_at = at.toISOString().replace(/\.\d{3}Z$/, "+00:00");
    if (opp.status === "lost") opp.lost_reason = client.data.lostReasons[0];

    const envelope = {
      id: crypto.randomUUID(),
      type: "opportunity.stage_updated",
      account: "tdemo0000",
      api_version: "2026-10",
      created_at: at.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      data: {
        object: { type: "opportunity", id: opp.id },
        opportunity: { id: opp.id, name: opp.description, description: opp.description, status: opp.status, temperature: opp.temperature, job_type: opp.job_type?.name ?? null, site_address: null, closed_at: opp.closed_at, completed_at: null },
        customer: { id: opp.customer?.id, name: opp.customer?.name, email: null, phone: null },
        salesrep: opp.sales_rep,
        stage: { id: next.id, name: next.name },
        previous_stage: { id: prev.id, name: prev.name },
      },
    };
    const raw = JSON.stringify(envelope);
    const res = await ingestWebhook(db, {
      rawBody: raw,
      signatureHeader: signPreciseBody(raw, DEMO_WEBHOOK_SECRET),
      webhookIdHeader: envelope.id,
      secrets: [DEMO_WEBHOOK_SECRET],
      expectedAccount: null,
    });
    if (res.status === 200) results.push(opp.id);
  }
  await processPendingEvents({ db, client, tz: companyTimezone() }, { limit: 500 });
  return results.length;
}
