import { and, asc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { customers, opportunities, syncCheckpoints, syncRuns } from "@/db/schema";
import type { PbClient } from "@/server/pb/client";
import { log } from "@/lib/logger";
import {
  markOpportunityMissing,
  RefResolver,
  syncActivities,
  syncLookups,
  upsertCustomer,
  upsertOpportunity,
} from "./upsert";

export type SyncType = "full" | "reconcile";
export type SyncTrigger = "cron" | "manual" | "cli" | "demo-seed";

export type SyncOptions = {
  db: Db;
  client: PbClient;
  tz: string;
  trigger: SyncTrigger;
  /** Stop and checkpoint once this much wall time is used (serverless limits). */
  budgetMs?: number;
  /** Activities fetched per reconcile run (one PB call per opportunity). */
  activityBatch?: number;
  pageLimit?: number;
};

export type SyncOutcome = {
  runId: number | null;
  status: "succeeded" | "partial" | "failed" | "skipped";
  recordsProcessed: number;
  message?: string;
};

/** A run still "running" after this long is assumed to have been killed by the platform. */
const STALE_RUN_MS = 15 * 60_000;

async function startRun(db: Db, syncType: SyncType, trigger: SyncTrigger): Promise<number | null> {
  await db
    .update(syncRuns)
    .set({ status: "abandoned", completedAt: new Date(), errorMessage: "Run exceeded time limit without finishing" })
    .where(
      and(
        eq(syncRuns.syncType, syncType),
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, new Date(Date.now() - STALE_RUN_MS)),
      ),
    );
  const rows = await db
    .insert(syncRuns)
    .values({ syncType, trigger })
    .onConflictDoNothing()
    .returning({ id: syncRuns.id });
  return rows[0]?.id ?? null;
}

async function finishRun(db: Db, id: number, o: Omit<SyncOutcome, "runId">, details: unknown) {
  await db
    .update(syncRuns)
    .set({
      status: o.status === "skipped" ? "skipped" : o.status,
      completedAt: new Date(),
      recordsProcessed: o.recordsProcessed,
      errorMessage: o.message ?? null,
      details: details as object,
    })
    .where(eq(syncRuns.id, id));
}

async function getCheckpoint<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.key, key));
  return (row?.value as T) ?? null;
}

async function setCheckpoint(db: Db, key: string, value: unknown) {
  await db
    .insert(syncCheckpoints)
    .values({ key, value: value as object })
    .onConflictDoUpdate({ target: syncCheckpoints.key, set: { value: value as object, updatedAt: new Date() } });
}

async function clearCheckpoint(db: Db, key: string) {
  await db.delete(syncCheckpoints).where(eq(syncCheckpoints.key, key));
}

type FullCheckpoint = {
  /** Run id that started this pass; records seen are stamped with it. */
  passId: number;
  phase: "lookups" | "customers" | "opportunities" | "activities" | "finalize";
  cursor: string | null;
  lastOppId: number;
  initialImport: boolean;
  processed: number;
};

/**
 * Full import / consistency pass:
 *   lookups -> all customers -> all opportunities (incl. archived) ->
 *   activities of open opportunities -> mark records PB no longer returns.
 * Resumable: when the time budget runs out the run ends as "partial" and the next
 * full run continues from the stored checkpoint.
 */
export async function runFullSync(opts: SyncOptions): Promise<SyncOutcome> {
  const { db, client, tz } = opts;
  const runId = await startRun(db, "full", opts.trigger);
  if (runId === null) return { runId: null, status: "skipped", recordsProcessed: 0, message: "A full sync is already running" };

  const started = Date.now();
  const outOfTime = () => opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs;
  const refs = new RefResolver(db);
  let cp = await getCheckpoint<FullCheckpoint>(db, "full");
  if (!cp) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(opportunities);
    cp = { passId: runId, phase: "lookups", cursor: null, lastOppId: 0, initialImport: Number(n) === 0, processed: 0 };
  }
  let processed = 0;

  let steps = 0;
  try {
    for (;;) {
      // Always make at least one step of progress per run, so a slow start can never stall the import.
      if (steps++ > 0 && outOfTime()) {
        await setCheckpoint(db, "full", cp);
        const o = { status: "partial" as const, recordsProcessed: processed, message: `Paused in phase "${cp.phase}"; the next full sync resumes here.` };
        await finishRun(db, runId, o, { checkpoint: cp });
        return { runId, ...o };
      }

      if (cp.phase === "lookups") {
        processed += await syncLookups(db, client);
        refs.invalidate();
        cp = { ...cp, phase: "customers", cursor: null };
      } else if (cp.phase === "customers") {
        const page = await client.listCustomers({ cursor: cp.cursor, limit: opts.pageLimit, includeArchived: true });
        const fetchedAt = new Date();
        for (const c of page.data) {
          await upsertCustomer(db, refs, c, { fetchedAt, fullSyncId: cp.passId, initialImport: cp.initialImport });
        }
        processed += page.data.length;
        cp = page.nextCursor ? { ...cp, cursor: page.nextCursor } : { ...cp, phase: "opportunities", cursor: null };
      } else if (cp.phase === "opportunities") {
        const page = await client.listOpportunities({ cursor: cp.cursor, limit: opts.pageLimit, includeArchived: true });
        const fetchedAt = new Date();
        for (const o of page.data) {
          await upsertOpportunity(db, refs, o, { fetchedAt, fullSyncId: cp.passId, initialImport: cp.initialImport });
        }
        processed += page.data.length;
        cp = page.nextCursor ? { ...cp, cursor: page.nextCursor } : { ...cp, phase: "activities", cursor: null, lastOppId: 0 };
      } else if (cp.phase === "activities") {
        const batch = await db
          .select({ id: opportunities.id, pbId: opportunities.pbId })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.status, "pending"),
              eq(opportunities.archived, false),
              isNull(opportunities.pbMissingAt),
              gt(opportunities.id, cp.lastOppId),
            ),
          )
          .orderBy(asc(opportunities.id))
          .limit(25);
        let done = 0;
        for (const opp of batch) {
          processed += await syncActivities(db, client, refs, opp, tz);
          cp = { ...cp, lastOppId: opp.id };
          done++;
          if (outOfTime()) break;
        }
        // The last (short) batch has been fully processed: move on.
        if (batch.length < 25 && done === batch.length) cp = { ...cp, phase: "finalize" };
      } else {
        // Records not returned during this complete pass no longer exist in PB (or were deleted).
        const missing = await db
          .select({ pbId: opportunities.pbId })
          .from(opportunities)
          .where(
            and(
              isNull(opportunities.pbMissingAt),
              or(isNull(opportunities.lastSeenFullSyncId), ne(opportunities.lastSeenFullSyncId, cp.passId)),
            ),
          );
        await markOpportunityMissing(db, missing.map((m) => m.pbId), new Date());
        await db
          .update(customers)
          .set({ pbMissingAt: new Date() })
          .where(
            and(
              isNull(customers.pbMissingAt),
              or(isNull(customers.lastSeenFullSyncId), ne(customers.lastSeenFullSyncId, cp.passId)),
            ),
          );
        await clearCheckpoint(db, "full");
        const o = { status: "succeeded" as const, recordsProcessed: processed };
        await finishRun(db, runId, o, { passId: cp.passId, missingOpportunities: missing.length });
        log.info("sync.full.done", { runId, processed, missing: missing.length });
        return { runId, ...o };
      }
    }
  } catch (e) {
    await setCheckpoint(db, "full", cp);
    const o = { status: "failed" as const, recordsProcessed: processed, message: (e as Error).message };
    await finishRun(db, runId, o, { checkpoint: cp });
    log.error("sync.full.failed", { runId, error: (e as Error).message });
    return { runId, ...o };
  }
}

type ReconcileCheckpoint = { lastActivityOppId: number };

/**
 * Reconciliation for missed webhooks (PB has no updated-since filter, so we re-read
 * what matters most):
 *   1. lookups;
 *   2. every open (status=pending) opportunity in PB;
 *   3. opportunities still open locally but no longer open in PB are fetched one by one
 *      (they were won, lost, archived or deleted);
 *   4. activities for a rotating batch of open opportunities.
 */
export async function runReconcile(opts: SyncOptions): Promise<SyncOutcome> {
  const { db, client, tz } = opts;
  const runId = await startRun(db, "reconcile", opts.trigger);
  if (runId === null) return { runId: null, status: "skipped", recordsProcessed: 0, message: "A reconciliation is already running" };
  const started = Date.now();
  const outOfTime = () => opts.budgetMs !== undefined && Date.now() - started > opts.budgetMs;
  const refs = new RefResolver(db);
  let processed = 0;
  const details: Record<string, number> = { openInPb: 0, closedSinceLastSync: 0, missing: 0, activityOpps: 0, changed: 0 };

  try {
    processed += await syncLookups(db, client);
    refs.invalidate();

    const seenOpen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await client.listOpportunities({ cursor, status: "pending", limit: opts.pageLimit });
      const fetchedAt = new Date();
      for (const o of page.data) {
        const r = await upsertOpportunity(db, refs, o, { fetchedAt });
        if (r.changed) details.changed++;
        seenOpen.push(o.id);
      }
      processed += page.data.length;
      cursor = page.nextCursor;
    } while (cursor && !outOfTime());
    details.openInPb = seenOpen.length;

    if (!cursor) {
      // Only valid when we saw the complete open list.
      const localOpen = await db
        .select({ id: opportunities.id, pbId: opportunities.pbId })
        .from(opportunities)
        .where(and(eq(opportunities.status, "pending"), eq(opportunities.archived, false), isNull(opportunities.pbMissingAt)));
      const openSet = new Set(seenOpen);
      const stale = localOpen.filter((o) => !openSet.has(o.pbId));
      for (const s of stale) {
        if (outOfTime()) break;
        const fresh = await client.getOpportunity(s.pbId);
        if (fresh) {
          await upsertOpportunity(db, refs, fresh, { fetchedAt: new Date() });
          details.closedSinceLastSync++;
        } else {
          await markOpportunityMissing(db, [s.pbId], new Date());
          details.missing++;
        }
        processed++;
      }
    }

    const cp = (await getCheckpoint<ReconcileCheckpoint>(db, "reconcile")) ?? { lastActivityOppId: 0 };
    const batchSize = opts.activityBatch ?? 40;
    let batch = await openOppsAfter(db, cp.lastActivityOppId, batchSize);
    if (batch.length === 0 && cp.lastActivityOppId > 0) batch = await openOppsAfter(db, 0, batchSize);
    let last = cp.lastActivityOppId;
    for (const opp of batch) {
      if (outOfTime()) break;
      processed += await syncActivities(db, client, refs, opp, tz);
      details.activityOpps++;
      last = opp.id;
    }
    await setCheckpoint(db, "reconcile", { lastActivityOppId: batch.length < batchSize ? 0 : last });

    const o = { status: (cursor ? "partial" : "succeeded") as "partial" | "succeeded", recordsProcessed: processed };
    await finishRun(db, runId, o, details);
    log.info("sync.reconcile.done", { runId, processed, ...details });
    return { runId, ...o };
  } catch (e) {
    const o = { status: "failed" as const, recordsProcessed: processed, message: (e as Error).message };
    await finishRun(db, runId, o, details);
    log.error("sync.reconcile.failed", { runId, error: (e as Error).message });
    return { runId, ...o };
  }
}

function openOppsAfter(db: Db, afterId: number, limit: number) {
  return db
    .select({ id: opportunities.id, pbId: opportunities.pbId })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.status, "pending"),
        eq(opportunities.archived, false),
        isNull(opportunities.pbMissingAt),
        gt(opportunities.id, afterId),
      ),
    )
    .orderBy(asc(opportunities.id))
    .limit(limit);
}

export async function hasFullSyncCheckpoint(db: Db) {
  return (await getCheckpoint(db, "full")) !== null;
}

