import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  activities,
  customers,
  jobTypes,
  leadSources,
  lostReasons,
  opportunities,
  opportunitySnapshots,
  salespeople,
  salesStages,
  stageTransitions,
} from "@/db/schema";
import { toCents } from "@/lib/money";
import { activityDueAt, LOCAL_DATE_RE } from "@/lib/time";
import type { PbActivity, PbCustomer, PbLookupEntry, PbOpportunity, PbSalesStage } from "@/server/pb/types";
import type { PbClient } from "@/server/pb/client";

type Ref = { id: string; name?: string | null } | null | undefined;
type RefTable = typeof salespeople | typeof salesStages | typeof jobTypes | typeof leadSources | typeof lostReasons;

/**
 * Maps PB ids to local ids for linked records, creating rows for references that
 * are not (or no longer) in PB's lookup lists — e.g. a former sales rep still
 * assigned to old opportunities.
 */
export class RefResolver {
  private maps = new Map<RefTable, Map<string, number>>();
  private userToSalesperson: Map<string, number> | null = null;

  constructor(private readonly db: Db) {}

  async id(table: RefTable, ref: Ref, extra?: Record<string, unknown>): Promise<number | null> {
    if (!ref?.id) return null;
    let map = this.maps.get(table);
    if (!map) {
      const rows = await this.db.select({ id: table.id, pbId: table.pbId }).from(table);
      map = new Map(rows.map((r) => [r.pbId, r.id]));
      this.maps.set(table, map);
    }
    const hit = map.get(ref.id);
    if (hit !== undefined) return hit;
    const values = { pbId: ref.id, name: ref.name ?? "(unnamed)", ...extra } as typeof table.$inferInsert;
    const [row] = await this.db
      .insert(table)
      .values(values)
      .onConflictDoUpdate({ target: table.pbId, set: { pbId: sql`excluded.pb_id` } })
      .returning({ id: table.id });
    map.set(ref.id, row.id);
    return row.id;
  }

  async salespersonForUser(pbUserId: string | null | undefined): Promise<number | null> {
    if (!pbUserId) return null;
    if (!this.userToSalesperson) {
      const rows = await this.db
        .select({ id: salespeople.id, pbUserId: salespeople.pbUserId })
        .from(salespeople)
        .where(sql`${salespeople.pbUserId} is not null`);
      this.userToSalesperson = new Map(rows.map((r) => [r.pbUserId!, r.id]));
    }
    return this.userToSalesperson.get(pbUserId) ?? null;
  }

  invalidate() {
    this.maps.clear();
    this.userToSalesperson = null;
  }
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export async function syncLookups(db: Db, client: PbClient) {
  const [reps, stages, types, sources, reasons, pbUsers] = await Promise.all([
    client.listSalesReps(),
    client.listSalesStages(),
    client.listJobTypes(),
    client.listLeadSources(),
    client.listLostReasons(),
    client.listUsers(),
  ]);

  await db.transaction(async (tx) => {
    await upsertSimple(tx, salespeople, reps, { active: true });
    const repIds = reps.map((r) => r.id);
    await tx
      .update(salespeople)
      .set({ active: false, updatedAt: new Date() })
      .where(repIds.length ? notInArray(salespeople.pbId, repIds) : sql`true`);

    await upsertStages(tx, stages);
    await upsertSimple(tx, jobTypes, types);
    await upsertSimple(tx, leadSources, sources);
    await upsertSimple(tx, lostReasons, reasons);
    await autoMapUsers(tx, pbUsers);
  });

  return reps.length + stages.length + types.length + sources.length + reasons.length;
}

async function upsertSimple(db: Db, table: RefTable, entries: PbLookupEntry[], extra: Record<string, unknown> = {}) {
  if (!entries.length) return;
  await db
    .insert(table)
    .values(entries.map((e) => ({ pbId: e.id, name: e.name, ...extra })) as (typeof table.$inferInsert)[])
    .onConflictDoUpdate({
      target: table.pbId,
      set: { name: sql`excluded.name`, updatedAt: new Date(), ...extra } as Record<string, unknown>,
    });
}

async function upsertStages(db: Db, stages: PbSalesStage[]) {
  if (stages.length) {
    await db
      .insert(salesStages)
      .values(stages.map((s, i) => ({ pbId: s.id, name: s.name, status: s.status ?? null, position: i, active: true })))
      .onConflictDoUpdate({
        target: salesStages.pbId,
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          position: sql`excluded.position`,
          active: true,
          updatedAt: new Date(),
        },
      });
  }
  const ids = stages.map((s) => s.id);
  await db
    .update(salesStages)
    .set({ active: false, position: null })
    .where(ids.length ? notInArray(salesStages.pbId, ids) : sql`true`);
}

/**
 * PB does not document a link between sales reps (/sales-reps) and users (/users),
 * which activities are assigned to. Map them by exact, unique, case-insensitive
 * name match, only where an admin has not set a mapping.
 */
async function autoMapUsers(db: Db, pbUsers: PbLookupEntry[]) {
  const byName = new Map<string, string[]>();
  for (const u of pbUsers) {
    const k = u.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), u.id]);
  }
  const reps = await db.select().from(salespeople).where(isNull(salespeople.pbUserId));
  const taken = new Set(
    (await db.select({ u: salespeople.pbUserId }).from(salespeople)).map((r) => r.u).filter(Boolean),
  );
  for (const rep of reps) {
    const ids = byName.get(rep.name.trim().toLowerCase());
    if (ids?.length === 1 && !taken.has(ids[0])) {
      await db.update(salespeople).set({ pbUserId: ids[0] }).where(eq(salespeople.id, rep.id));
      taken.add(ids[0]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export type UpsertContext = {
  /** When the PB data was fetched; an older fetch never overwrites a newer one. */
  fetchedAt: Date;
  /** Envelope created_at of the webhook that triggered the fetch. */
  eventAt?: Date | null;
  fullSyncId?: number | null;
  initialImport?: boolean;
  /** The caller already recorded a webhook-sourced transition for any stage change. */
  stageChangeExplained?: boolean;
};

export function customerName(c: Pick<PbCustomer, "display_name" | "first_name" | "last_name" | "company">) {
  return (
    c.display_name?.trim() ||
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    c.company?.trim() ||
    "(unnamed customer)"
  );
}

/** Keep raw PB data for debugging, minus contact details we never need. */
function stripContact<T extends Record<string, unknown>>(raw: T) {
  const { phones: _p, emails: _e, billing_address: _b, ...rest } = raw as Record<string, unknown>;
  void _p;
  void _e;
  void _b;
  return rest;
}

export async function upsertCustomer(db: Db, refs: RefResolver, c: PbCustomer, ctx: UpsertContext) {
  const leadSourceId = await refs.id(leadSources, c.lead_source);
  const salespersonId = await refs.id(salespeople, c.sales_rep, { active: false });
  const values = {
    name: customerName(c),
    leadSourceId,
    salespersonId,
    archived: c.archived ?? false,
    pbCreatedDate: c.created_date && LOCAL_DATE_RE.test(c.created_date) ? c.created_date : null,
    rawData: stripContact(c),
  };

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(customers).where(eq(customers.pbId, c.id)).for("update");
    if (existing?.lastSyncedAt && existing.lastSyncedAt > ctx.fetchedAt) return existing.id;

    if (!existing) {
      const [row] = await tx
        .insert(customers)
        .values({
          pbId: c.id,
          ...values,
          lastPbEventAt: ctx.eventAt ?? null,
          lastSyncedAt: ctx.fetchedAt,
          lastSeenFullSyncId: ctx.fullSyncId ?? null,
        })
        .returning({ id: customers.id });
      return row.id;
    }
    const changed =
      existing.name !== values.name ||
      existing.leadSourceId !== values.leadSourceId ||
      existing.salespersonId !== values.salespersonId ||
      existing.archived !== values.archived;
    await tx
      .update(customers)
      .set({
        ...values,
        lastPbEventAt: maxDate(existing.lastPbEventAt, ctx.eventAt),
        lastChangedAt: changed ? (ctx.eventAt ?? ctx.fetchedAt) : existing.lastChangedAt,
        lastSyncedAt: ctx.fetchedAt,
        lastSeenFullSyncId: ctx.fullSyncId ?? existing.lastSeenFullSyncId,
        pbMissingAt: null,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, existing.id));
    return existing.id;
  });
}

/** Minimal customer row for an opportunity whose customer has not been synced yet. */
async function ensureCustomerStub(db: Db, ref: Ref): Promise<number | null> {
  if (!ref?.id) return null;
  const [row] = await db
    .insert(customers)
    .values({ pbId: ref.id, name: ref.name ?? "(unnamed customer)" })
    .onConflictDoUpdate({ target: customers.pbId, set: { pbId: sql`excluded.pb_id` } })
    .returning({ id: customers.id });
  return row.id;
}

/* ------------------------------------------------------------------ */
/* Opportunities                                                       */
/* ------------------------------------------------------------------ */

function parseTs(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

export type UpsertOpportunityResult = {
  id: number;
  created: boolean;
  changed: boolean;
  stageChanged: boolean;
  skippedStale: boolean;
};

export async function upsertOpportunity(
  db: Db,
  refs: RefResolver,
  o: PbOpportunity,
  ctx: UpsertContext,
): Promise<UpsertOpportunityResult> {
  const customerId = await ensureCustomerStub(db, o.customer);
  const salespersonId = await refs.id(salespeople, o.sales_rep, { active: false });
  const stageId = await refs.id(salesStages, o.sales_stage, { active: false });
  const jobTypeId = await refs.id(jobTypes, o.job_type);
  const lostReasonId = await refs.id(lostReasons, o.lost_reason);

  const values = {
    number: o.number ?? null,
    customerId,
    salespersonId,
    name: o.description?.trim() || (o.number ? `Job ${o.number}` : "(no description)"),
    stageId,
    status: o.status,
    valueCents: toCents(o.revenue),
    jobTypeId,
    leadTemperature: o.temperature ?? null,
    lostReasonId,
    archived: o.archived ?? false,
    pbCreatedDate: o.created_date && LOCAL_DATE_RE.test(o.created_date) ? o.created_date : null,
    closedAt: parseTs(o.closed_at),
    completedAt: parseTs(o.completed_at),
    rawData: stripContact(o as Record<string, unknown>),
  };

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(opportunities).where(eq(opportunities.pbId, o.id)).for("update");

    if (existing?.lastSyncedAt && existing.lastSyncedAt > ctx.fetchedAt) {
      // A newer fetch already landed; still remember that this event happened.
      if (ctx.eventAt) {
        await tx
          .update(opportunities)
          .set({ lastPbEventAt: maxDate(existing.lastPbEventAt, ctx.eventAt) })
          .where(eq(opportunities.id, existing.id));
      }
      return { id: existing.id, created: false, changed: false, stageChanged: false, skippedStale: true };
    }

    if (!existing) {
      const [row] = await tx
        .insert(opportunities)
        .values({
          pbId: o.id,
          ...values,
          lastPbEventAt: ctx.eventAt ?? null,
          lastSyncedAt: ctx.fetchedAt,
          lastSeenFullSyncId: ctx.fullSyncId ?? null,
        })
        .returning({ id: opportunities.id });
      await tx.insert(opportunitySnapshots).values({
        opportunityId: row.id,
        salespersonId,
        stageId,
        status: o.status,
        valueCents: values.valueCents,
        reason: ctx.initialImport ? "initial_import" : "created",
        capturedAt: ctx.fetchedAt,
      });
      await recomputeStageEntered(tx, row.id);
      return { id: row.id, created: true, changed: true, stageChanged: false, skippedStale: false };
    }

    const stageChanged = existing.stageId !== values.stageId;
    const snapshotChanged =
      stageChanged ||
      existing.status !== values.status ||
      existing.valueCents !== values.valueCents ||
      existing.salespersonId !== values.salespersonId;
    const changed =
      snapshotChanged ||
      existing.name !== values.name ||
      existing.jobTypeId !== values.jobTypeId ||
      existing.leadTemperature !== values.leadTemperature ||
      existing.lostReasonId !== values.lostReasonId ||
      existing.archived !== values.archived ||
      existing.customerId !== values.customerId ||
      existing.closedAt?.getTime() !== values.closedAt?.getTime() ||
      existing.completedAt?.getTime() !== values.completedAt?.getTime();

    await tx
      .update(opportunities)
      .set({
        ...values,
        lastPbEventAt: maxDate(existing.lastPbEventAt, ctx.eventAt),
        lastChangedAt: changed ? (ctx.eventAt ?? ctx.fetchedAt) : existing.lastChangedAt,
        lastSyncedAt: ctx.fetchedAt,
        lastSeenFullSyncId: ctx.fullSyncId ?? existing.lastSeenFullSyncId,
        pbMissingAt: null,
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, existing.id));

    if (snapshotChanged) {
      await tx.insert(opportunitySnapshots).values({
        opportunityId: existing.id,
        salespersonId,
        stageId,
        status: o.status,
        valueCents: values.valueCents,
        reason: "change",
        capturedAt: ctx.fetchedAt,
      });
    }

    if (stageChanged && !ctx.stageChangeExplained) {
      const already = await hasWebhookTransitionInto(tx, existing.id, values.stageId, existing.lastSyncedAt);
      if (!already) {
        await tx.insert(stageTransitions).values({
          opportunityId: existing.id,
          previousStageId: existing.stageId,
          newStageId: values.stageId,
          previousStageName: await stageName(tx, existing.stageId),
          newStageName: o.sales_stage?.name ?? null,
          salespersonId,
          transitionedAt: ctx.fetchedAt,
          source: "reconciliation",
        });
      }
    }

    await recomputeStageEntered(tx, existing.id);
    return { id: existing.id, created: false, changed, stageChanged, skippedStale: false };
  });
}

async function stageName(db: Db, id: number | null) {
  if (id === null) return null;
  const [r] = await db.select({ name: salesStages.name }).from(salesStages).where(eq(salesStages.id, id));
  return r?.name ?? null;
}

async function hasWebhookTransitionInto(db: Db, oppId: number, stageId: number | null, since: Date | null) {
  if (stageId === null) return false;
  const rows = await db
    .select({ id: stageTransitions.id })
    .from(stageTransitions)
    .where(
      and(
        eq(stageTransitions.opportunityId, oppId),
        eq(stageTransitions.newStageId, stageId),
        eq(stageTransitions.source, "webhook"),
        since ? sql`${stageTransitions.transitionedAt} >= ${since}` : sql`true`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Stage aging needs a *verified* entry into the current stage. That exists only if the
 * latest recorded transition (any source) moved the opportunity into its current stage
 * and came from a webhook. Otherwise the entry time is unknown.
 */
export async function recomputeStageEntered(db: Db, oppId: number) {
  const [opp] = await db.select({ stageId: opportunities.stageId }).from(opportunities).where(eq(opportunities.id, oppId));
  const [latest] = await db
    .select()
    .from(stageTransitions)
    .where(eq(stageTransitions.opportunityId, oppId))
    .orderBy(desc(stageTransitions.transitionedAt), desc(stageTransitions.id))
    .limit(1);
  const entered =
    latest && latest.source === "webhook" && latest.newStageId !== null && latest.newStageId === opp?.stageId
      ? latest.transitionedAt
      : null;
  await db.update(opportunities).set({ stageEnteredAt: entered }).where(eq(opportunities.id, oppId));
}

/* ------------------------------------------------------------------ */
/* Activities                                                          */
/* ------------------------------------------------------------------ */

export async function upsertActivitiesForOpportunity(
  db: Db,
  refs: RefResolver,
  opportunityId: number,
  list: PbActivity[],
  ctx: { fetchedAt: Date; tz: string; createdEvent?: { pbActivityId: string; at: Date } },
) {
  for (const a of list) {
    const completedAt = parseTs(a.completed_at);
    const salespersonId = await refs.salespersonForUser(a.assigned_user?.id);
    const values = {
      opportunityId,
      salespersonId,
      assignedUserPbId: a.assigned_user?.id ?? null,
      assignedUserName: a.assigned_user?.name ?? null,
      title: a.title,
      type: a.type ?? "task",
      status: completedAt ? "completed" : "open",
      dueDate: a.due_date && LOCAL_DATE_RE.test(a.due_date) ? a.due_date : null,
      beginTime: a.begin_time ?? null,
      dueAt: activityDueAt(a.due_date, a.begin_time, ctx.tz),
      completedAt,
      removedAt: null,
      lastSyncedAt: ctx.fetchedAt,
      rawData: a as Record<string, unknown>,
      updatedAt: new Date(),
    };
    const pbCreatedAt = ctx.createdEvent?.pbActivityId === a.id ? ctx.createdEvent.at : undefined;
    await db
      .insert(activities)
      .values({ pbId: a.id, ...values, pbCreatedAt: pbCreatedAt ?? null })
      .onConflictDoUpdate({
        target: activities.pbId,
        set: { ...values, ...(pbCreatedAt ? { pbCreatedAt } : {}) },
      });
  }
  const seen = list.map((a) => a.id);
  await db
    .update(activities)
    .set({ removedAt: ctx.fetchedAt })
    .where(
      and(
        eq(activities.opportunityId, opportunityId),
        isNull(activities.removedAt),
        seen.length ? notInArray(activities.pbId, seen) : sql`true`,
      ),
    );
  await db.update(opportunities).set({ activitiesSyncedAt: ctx.fetchedAt }).where(eq(opportunities.id, opportunityId));
}

export async function syncActivities(
  db: Db,
  client: PbClient,
  refs: RefResolver,
  opp: { id: number; pbId: string },
  tz: string,
  createdEvent?: { pbActivityId: string; at: Date },
) {
  const fetchedAt = new Date();
  const list = await client.listActivities(opp.pbId);
  await upsertActivitiesForOpportunity(db, refs, opp.id, list, { fetchedAt, tz, createdEvent });
  return list.length;
}

export async function markOpportunityMissing(db: Db, pbIds: string[], at: Date) {
  if (!pbIds.length) return;
  await db
    .update(opportunities)
    .set({ pbMissingAt: at })
    .where(and(inArray(opportunities.pbId, pbIds), isNull(opportunities.pbMissingAt)));
}
