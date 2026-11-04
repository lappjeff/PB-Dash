import "server-only";
import { getDb } from "@/db";
import { companyTimezone } from "@/env";
import { getPbClient } from "@/server/pb";
import { runFullSync, runReconcile, type SyncTrigger } from "@/server/sync/runs";
import { processPendingEvents, prunePayloads } from "@/server/webhooks/process";

/** Leave headroom under the function's maxDuration (300s). */
export const JOB_BUDGET_MS = 240_000;

async function deps() {
  return { db: await getDb(), client: getPbClient(), tz: companyTimezone() };
}

export async function jobProcessEvents(opts: { eventIds?: number[]; limit?: number; budgetMs?: number } = {}) {
  return processPendingEvents(await deps(), { limit: opts.limit ?? 100, eventIds: opts.eventIds, budgetMs: opts.budgetMs ?? JOB_BUDGET_MS });
}

export async function jobReconcile(trigger: SyncTrigger) {
  const d = await deps();
  // Drain the webhook queue first so reconciliation compares against the freshest state.
  const events = await processPendingEvents(d, { limit: 200, budgetMs: 60_000 });
  const sync = await runReconcile({ ...d, trigger, budgetMs: JOB_BUDGET_MS - 60_000 });
  await prunePayloads(d.db);
  return { events, sync };
}

export async function jobFullSync(trigger: SyncTrigger) {
  return runFullSync({ ...(await deps()), trigger, budgetMs: JOB_BUDGET_MS });
}
