import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { customers, invoices, opportunities, salespeople, salesStages, stageTransitions, vendors, webhookEvents } from "@/db/schema";
import type { PbClient } from "@/server/pb/client";
import { pbActivityEventData, pbInvoiceEventData, pbStageUpdatedData, pbVendorEventData, type PbWebhookEnvelope } from "@/server/pb/types";
import { toCents } from "@/lib/money";
import {
  markOpportunityMissing,
  recomputeStageEntered,
  RefResolver,
  syncActivities,
  upsertCustomer,
  upsertOpportunity,
} from "@/server/sync/upsert";
import { log } from "@/lib/logger";

export const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000];
const LOCK_TIMEOUT_MS = 5 * 60_000;

type Row = typeof webhookEvents.$inferSelect;
type Outcome = { status: "processed" | "ignored"; note?: string };

export type ProcessDeps = { db: Db; client: PbClient; tz: string };

/**
 * Claims due events with FOR UPDATE SKIP LOCKED (safe with concurrent invocations),
 * oldest event first, and processes them. Events are retried with backoff and become
 * "dead" after MAX_ATTEMPTS.
 */
export async function processPendingEvents(
  deps: ProcessDeps,
  opts: { limit?: number; eventIds?: number[]; budgetMs?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const started = Date.now();
  const lockCutoff = new Date(Date.now() - LOCK_TIMEOUT_MS);
  const idFilter = opts.eventIds?.length
    ? sql`and id in (${sql.join(opts.eventIds.map((i) => sql`${i}`), sql`, `)})`
    : sql``;

  const claimed = (await deps.db.execute(sql`
    update webhook_events set processing_status = 'processing', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from webhook_events
      where (
        processing_status = 'pending'
        or (processing_status = 'failed' and (next_attempt_at is null or next_attempt_at <= now()))
        or (processing_status = 'processing' and locked_at < ${lockCutoff})
      )
      and attempts < ${MAX_ATTEMPTS}
      ${idFilter}
      order by event_created_at asc nulls last, id asc
      limit ${limit}
      for update skip locked
    )
    returning id
  `)) as unknown as { rows?: { id: number }[] } | { id: number }[];
  const ids = (Array.isArray(claimed) ? claimed : (claimed.rows ?? [])).map((r) => Number(r.id));

  const summary = { claimed: ids.length, processed: 0, ignored: 0, failed: 0 };
  if (!ids.length) return summary;
  const refs = new RefResolver(deps.db);

  const rows = await deps.db
    .select()
    .from(webhookEvents)
    .where(sql`${webhookEvents.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
    .orderBy(sql`event_created_at asc nulls last, id asc`);

  for (const row of rows) {
    if (opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs) {
      // Release unprocessed claims for the next run.
      await deps.db
        .update(webhookEvents)
        .set({ processingStatus: "pending", lockedAt: null, attempts: sql`${webhookEvents.attempts} - 1` })
        .where(eq(webhookEvents.id, row.id));
      continue;
    }
    try {
      const out = await handleEvent(deps, refs, row);
      await deps.db
        .update(webhookEvents)
        .set({
          processingStatus: out.status,
          processedAt: new Date(),
          lockedAt: null,
          nextAttemptAt: null,
          errorMessage: out.note ?? null,
        })
        .where(eq(webhookEvents.id, row.id));
      summary[out.status === "processed" ? "processed" : "ignored"]++;
    } catch (e) {
      const message = (e as Error).message?.slice(0, 2000) ?? "unknown error";
      const dead = row.attempts >= MAX_ATTEMPTS;
      await deps.db
        .update(webhookEvents)
        .set({
          processingStatus: dead ? "dead" : "failed",
          lockedAt: null,
          errorMessage: message,
          nextAttemptAt: dead ? null : new Date(Date.now() + BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]),
        })
        .where(eq(webhookEvents.id, row.id));
      summary.failed++;
      log.error("webhook.process.failed", { eventId: row.id, type: row.eventType, attempts: row.attempts, dead, error: message });
    }
  }
  return summary;
}

async function handleEvent(deps: ProcessDeps, refs: RefResolver, row: Row): Promise<Outcome> {
  const { db, client, tz } = deps;
  const payload = row.payload as PbWebhookEnvelope | null;
  const eventAt = row.eventCreatedAt;
  const entityId = row.entityId;

  switch (row.eventType) {
    case "webhook.ping":
      return { status: "processed", note: "ping" };

    case "customer.created":
    case "customer.updated": {
      if (!entityId) throw new Error("customer event without data.object.id");
      const fetchedAt = new Date();
      const c = await client.getCustomer(entityId);
      if (!c) return { status: "processed", note: "customer not found in PB (deleted?)" };
      await upsertCustomer(db, refs, c, { fetchedAt, eventAt });
      return { status: "processed" };
    }

    case "opportunity.created":
    case "job.updated":
    case "opportunity.stage_updated": {
      if (!entityId) throw new Error("opportunity event without data.object.id");
      const isStageEvent = row.eventType === "opportunity.stage_updated";
      // Current state always comes from the authoritative PB record, never the
      // (possibly older) payload, so out-of-order delivery cannot regress data.
      const fetchedAt = new Date();
      const o = await client.getOpportunity(entityId);
      if (!o) {
        await markOpportunityMissing(db, [entityId], fetchedAt);
        const [local] = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.pbId, entityId));
        if (isStageEvent && local && payload) {
          await recordWebhookTransition(db, refs, row, payload, local.id);
          await recomputeStageEntered(db, local.id);
        }
        return { status: "processed", note: "opportunity not found in PB (deleted or archived)" };
      }
      const r = await upsertOpportunity(db, refs, o, { fetchedAt, eventAt, stageChangeExplained: isStageEvent });
      if (isStageEvent && payload) {
        await recordWebhookTransition(db, refs, row, payload, r.id);
        await recomputeStageEntered(db, r.id);
      }
      if (row.eventType === "opportunity.created") {
        await syncActivities(db, client, refs, { id: r.id, pbId: entityId }, tz);
      }
      return { status: "processed", note: r.skippedStale ? "newer data already stored" : undefined };
    }

    case "activity.created":
    case "activity.completed": {
      const data = pbActivityEventData.safeParse(payload?.data);
      const jobId = data.success ? data.data.job?.id : undefined;
      if (!jobId) throw new Error("activity event without data.job.id");
      let [opp] = await db
        .select({ id: opportunities.id, pbId: opportunities.pbId })
        .from(opportunities)
        .where(eq(opportunities.pbId, jobId));
      if (!opp) {
        const o = await client.getOpportunity(jobId);
        if (!o) return { status: "processed", note: "activity's opportunity not found in PB" };
        const r = await upsertOpportunity(db, refs, o, { fetchedAt: new Date(), eventAt });
        opp = { id: r.id, pbId: jobId };
      }
      await syncActivities(
        db,
        client,
        refs,
        opp,
        tz,
        row.eventType === "activity.created" && entityId && eventAt ? { pbActivityId: entityId, at: eventAt } : undefined,
      );
      return { status: "processed" };
    }

    case "invoice.created": {
      const data = pbInvoiceEventData.safeParse(payload?.data);
      if (!data.success) throw new Error(`invoice payload did not match the documented schema: ${data.error.issues[0]?.path.join(".")}`);
      return { status: "processed", note: await upsertInvoice(db, client, refs, data.data, eventAt) };
    }

    case "vendor.created":
    case "vendor.updated": {
      const data = pbVendorEventData.safeParse(payload?.data);
      if (!data.success) throw new Error(`vendor payload did not match the documented schema: ${data.error.issues[0]?.path.join(".")}`);
      const v = data.data.vendor;
      const values = { name: v.name ?? null, company: v.company ?? null, lastPbEventAt: eventAt, updatedAt: new Date() };
      await db
        .insert(vendors)
        .values({ pbId: v.id, ...values })
        .onConflictDoUpdate({
          target: vendors.pbId,
          set: values,
          // A late or redelivered older event never overwrites newer details.
          setWhere: sql`${vendors.lastPbEventAt} is null or ${vendors.lastPbEventAt} <= excluded.last_pb_event_at`,
        });
      return { status: "processed" };
    }

    default:
      return { status: "ignored", note: `unknown event type "${row.eventType}"` };
  }
}

/**
 * Stores an invoice from its invoice.created payload (PB has no invoice REST endpoint).
 * Links it to the opportunity (PB jobs and opportunities are the same record), importing
 * the opportunity first if this system hasn't seen it.
 */
async function upsertInvoice(
  db: Db,
  client: PbClient,
  refs: RefResolver,
  data: import("@/server/pb/types").PbInvoiceEventData,
  eventAt: Date | null,
): Promise<string | undefined> {
  const inv = data.invoice;
  const jobId = data.job?.id ?? null;
  let note: string | undefined;
  let opportunityId: number | null = null;
  if (jobId) {
    const [opp] = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.pbId, jobId));
    if (opp) opportunityId = opp.id;
    else {
      const o = await client.getOpportunity(jobId);
      if (o) opportunityId = (await upsertOpportunity(db, refs, o, { fetchedAt: new Date(), eventAt })).id;
      else note = "invoice's job not found in PB";
    }
  }
  let customerId: number | null = null;
  if (data.customer?.id) {
    const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.pbId, data.customer.id));
    customerId = c?.id ?? null;
  }
  const values = {
    number: inv.number ?? null,
    type: inv.type ?? null,
    invoiceDate: inv.date ?? null,
    dueDate: inv.due_date ?? null,
    totalCents: toCents(inv.total),
    void: inv.void ?? false,
    pbJobId: jobId,
    opportunityId,
    pbCustomerId: data.customer?.id ?? null,
    customerId,
    lastPbEventAt: eventAt,
    updatedAt: new Date(),
  };
  await db
    .insert(invoices)
    .values({ pbId: inv.id, ...values })
    .onConflictDoUpdate({
      target: invoices.pbId,
      set: values,
      setWhere: sql`${invoices.lastPbEventAt} is null or ${invoices.lastPbEventAt} <= excluded.last_pb_event_at`,
    });
  return note;
}

/**
 * Records the transition carried by opportunity.stage_updated. The payload's stage and
 * previous_stage are trustworthy history even when the event arrives late or out of
 * order; ordering uses the envelope created_at. Idempotent per event.
 */
async function recordWebhookTransition(db: Db, refs: RefResolver, row: Row, payload: PbWebhookEnvelope, oppId: number) {
  const data = pbStageUpdatedData.safeParse(payload.data);
  if (!data.success || !row.eventCreatedAt) throw new Error("opportunity.stage_updated payload is missing stage data or created_at");
  const { stage, previous_stage, salesrep } = data.data;
  const opp = { id: oppId };

  const newStageId = await refs.id(salesStages, stage, { active: false });
  const previousStageId = await refs.id(salesStages, previous_stage, { active: false });
  const salespersonId = await refs.id(salespeople, salesrep, { active: false });

  await db.transaction(async (tx) => {
    await tx
      .insert(stageTransitions)
      .values({
        opportunityId: opp.id,
        previousStageId,
        newStageId,
        previousStageName: previous_stage?.name ?? null,
        newStageName: stage?.name ?? null,
        salespersonId,
        transitionedAt: row.eventCreatedAt!,
        source: "webhook",
        sourceEventId: row.id,
      })
      .onConflictDoNothing({ target: stageTransitions.sourceEventId });
    // A reconciliation pass may already have detected this move (with an approximate
    // time). The webhook is exact, so it replaces that inferred record.
    await tx
      .delete(stageTransitions)
      .where(
        and(
          eq(stageTransitions.opportunityId, opp.id),
          eq(stageTransitions.source, "reconciliation"),
          newStageId === null ? isNull(stageTransitions.newStageId) : eq(stageTransitions.newStageId, newStageId),
          sql`${stageTransitions.transitionedAt} >= ${row.eventCreatedAt!}`,
        ),
      );
  });
}

/** Clears stored payloads (they hold customer contact details) after the retention window. */
export async function prunePayloads(db: Db, olderThanDays = 30) {
  await db
    .update(webhookEvents)
    .set({ payload: null })
    .where(
      and(
        lt(webhookEvents.receivedAt, new Date(Date.now() - olderThanDays * 86_400_000)),
        sql`${webhookEvents.processingStatus} in ('processed','ignored','dead')`,
        sql`${webhookEvents.payload} is not null`,
      ),
    );
}
