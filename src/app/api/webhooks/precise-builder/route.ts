import { after, NextResponse } from "next/server";
import { getDb } from "@/db";
import { appMode, pbAccountId, webhookSecrets } from "@/env";
import { ingestWebhook } from "@/server/webhooks/ingest";
import { jobProcessEvents } from "@/server/jobs";
import { DEMO_WEBHOOK_SECRET } from "@/server/demo/constants";
import { log } from "@/lib/logger";

export const maxDuration = 60;

/**
 * Precise Builder webhook receiver. Verifies the signature over the raw body, stores the
 * event durably (deduplicated on the envelope id), answers 200 immediately, and processes
 * after the response. Anything not processed here is picked up by /api/cron/process-events.
 */
export async function POST(req: Request) {
  const secrets = appMode() === "demo" ? [...webhookSecrets(), DEMO_WEBHOOK_SECRET] : webhookSecrets();
  if (!secrets.length) {
    log.error("webhook.no_secret");
    // 5xx so PB retries once the secret is configured, rather than dropping the event.
    return NextResponse.json({ error: { code: "not-configured", message: "Webhook secret not configured" } }, { status: 503 });
  }
  const rawBody = await req.text();
  const db = await getDb();
  const result = await ingestWebhook(db, {
    rawBody,
    signatureHeader: req.headers.get("precise-signature"),
    webhookIdHeader: req.headers.get("precise-webhook-id"),
    secrets,
    expectedAccount: pbAccountId(),
  });
  if (result.status === 200 && result.body.eventId !== null) {
    const id = result.body.eventId;
    after(async () => {
      try {
        await jobProcessEvents({ eventIds: [id], budgetMs: 45_000 });
      } catch (e) {
        log.error("webhook.after_failed", { eventId: id, error: (e as Error).message });
      }
    });
  }
  return NextResponse.json(result.body, { status: result.status });
}
