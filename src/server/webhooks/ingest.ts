import crypto from "node:crypto";
import type { Db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { verifyPreciseSignature } from "@/server/pb/signature";
import { pbWebhookEnvelope } from "@/server/pb/types";
import { log } from "@/lib/logger";

export type IngestResult =
  | { status: 200; body: { received: true; duplicate: boolean; eventId: number | null } }
  | { status: 400 | 401; body: { error: { code: string; message: string } } };

export type IngestInput = {
  rawBody: string;
  signatureHeader: string | null;
  webhookIdHeader: string | null;
  secrets: string[];
  /** When known, events for any other PB account are rejected. */
  expectedAccount: string | null;
  nowSeconds?: number;
};

/**
 * Steps 1–7 of the webhook contract: raw body -> signature -> payload validation ->
 * durable insert (deduplicated on the envelope id) -> prompt acknowledgement.
 * Processing happens separately (see process.ts).
 */
export async function ingestWebhook(db: Db, input: IngestInput): Promise<IngestResult> {
  const sig = verifyPreciseSignature(input.rawBody, input.signatureHeader, input.secrets, input.nowSeconds);
  if (!sig.ok) {
    log.warn("webhook.rejected", { reason: sig.reason });
    return { status: 401, body: { error: { code: "invalid-signature", message: `Signature rejected: ${sig.reason}` } } };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: { code: "invalid-json", message: "Body is not JSON" } } };
  }
  const parsed = pbWebhookEnvelope.safeParse(json);
  if (!parsed.success) {
    return { status: 400, body: { error: { code: "invalid-envelope", message: "Payload does not match the documented envelope" } } };
  }
  const ev = parsed.data;
  if (input.expectedAccount && ev.account && ev.account !== input.expectedAccount) {
    log.warn("webhook.wrong_account", { account: ev.account });
    return { status: 400, body: { error: { code: "wrong-account", message: "Event is for a different PB account" } } };
  }

  // The envelope id is documented as unique and stable across retries. The header
  // carries the same value; a body hash is a last-resort fallback.
  const providerEventId =
    ev.id || input.webhookIdHeader || `sha256:${crypto.createHash("sha256").update(input.rawBody).digest("hex")}`;
  const createdAt = new Date(ev.created_at);

  const rows = await db
    .insert(webhookEvents)
    .values({
      providerEventId,
      eventType: ev.type,
      entityType: ev.data.object.type,
      entityId: ev.data.object.id,
      account: ev.account ?? null,
      apiVersion: ev.api_version ?? null,
      eventCreatedAt: Number.isNaN(createdAt.getTime()) ? null : createdAt,
      payload: json as object,
    })
    .onConflictDoNothing({ target: webhookEvents.providerEventId })
    .returning({ id: webhookEvents.id });

  const duplicate = rows.length === 0;
  log.info("webhook.received", { type: ev.type, providerEventId, duplicate });
  return { status: 200, body: { received: true, duplicate, eventId: rows[0]?.id ?? null } };
}
