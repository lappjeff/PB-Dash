import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { salesTargets, syncRuns, webhookEvents } from "@/db/schema";
import { inList, rows } from "@/db/sql";
import { toInt, toIntOrNull } from "@/lib/money";
import type { SalespersonScope } from "@/server/authz";
import { averageCents, winRate } from "./sales";
import { baseWhere, closedIn, FROM, OPEN, type Filters } from "./filters";

export type Breakdown = {
  key: number | null;
  name: string;
  created: number;
  wonCount: number;
  wonCents: number;
  wonMissing: number;
  lostCount: number;
  winRate: number | null;
  avgWonCents: number | null;
  /** Of opportunities created in the range, the share already won (cohort; still maturing). */
  cohortWon: number;
  cohortConversion: number | null;
};

async function breakdown(db: Db, f: Filters, scope: SalespersonScope, includeArchived: boolean, dim: "job_type" | "lead_source") {
  const keyCol = dim === "job_type" ? sql`o.job_type_id` : sql`c.lead_source_id`;
  const join = dim === "job_type" ? sql`left join job_types d on d.id = o.job_type_id` : sql`left join lead_sources d on d.id = c.lead_source_id`;
  const won = closedIn("won", f, includeArchived);
  const lost = closedIn("lost", f, includeArchived);
  const created = sql`o.pb_created_date >= ${f.from}::date and o.pb_created_date <= ${f.to}::date`;
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select ${keyCol} as key, coalesce(d.name, '(not set)') as name,
          count(*) filter (where ${created})::int as created,
          count(*) filter (where ${created} and o.status = 'won')::int as cohort_won,
          count(*) filter (where ${won})::int as won_count,
          coalesce(sum(o.value_cents) filter (where ${won}), 0)::bigint as won_cents,
          count(*) filter (where ${won} and o.value_cents is null)::int as won_missing,
          count(*) filter (where ${lost})::int as lost_count
        from ${FROM} ${join}
        where ${baseWhere(f, scope)}
        group by 1, 2 order by won_cents desc, name`,
  );
  return r
    .map((x): Breakdown => {
      const wonCount = toInt(x.won_count);
      const lostCount = toInt(x.lost_count);
      const createdN = toInt(x.created);
      const cohortWon = toInt(x.cohort_won);
      return {
        key: toIntOrNull(x.key),
        name: String(x.name),
        created: createdN,
        wonCount,
        wonCents: toInt(x.won_cents),
        wonMissing: toInt(x.won_missing),
        lostCount,
        winRate: winRate(wonCount, lostCount),
        avgWonCents: averageCents(toInt(x.won_cents), wonCount - toInt(x.won_missing)),
        cohortWon,
        cohortConversion: createdN ? cohortWon / createdN : null,
      };
    })
    .filter((b) => b.created + b.wonCount + b.lostCount > 0);
}

export const salesByJobType = (db: Db, f: Filters, s: SalespersonScope, a: boolean) => breakdown(db, f, s, a, "job_type");
export const salesByLeadSource = (db: Db, f: Filters, s: SalespersonScope, a: boolean) => breakdown(db, f, s, a, "lead_source");

export type CycleStats = { n: number; p25: number | null; median: number | null; p75: number | null; histogram: { label: string; count: number }[] };

export async function salesCycle(db: Db, f: Filters, scope: SalespersonScope, includeArchived: boolean): Promise<CycleStats> {
  const days = sql`((o.closed_at at time zone ${f.tz})::date - o.pb_created_date)`;
  const where = sql`${baseWhere(f, scope)} and ${closedIn("won", f, includeArchived)} and o.pb_created_date is not null`;
  const [s] = await rows<Record<string, unknown>>(
    db,
    sql`select count(*)::int as n,
          percentile_cont(0.25) within group (order by ${days}) as p25,
          percentile_cont(0.5) within group (order by ${days}) as p50,
          percentile_cont(0.75) within group (order by ${days}) as p75
        from ${FROM} where ${where}`,
  );
  const bins = [
    [0, 14, "0–2 wk"],
    [15, 30, "2–4 wk"],
    [31, 60, "1–2 mo"],
    [61, 90, "2–3 mo"],
    [91, 180, "3–6 mo"],
    [181, 100000, "6+ mo"],
  ] as const;
  const h = await rows<Record<string, unknown>>(
    db,
    sql`select ${sql.join(bins.map(([lo, hi], i) => sql`count(*) filter (where ${days} between ${lo} and ${hi})::int as b${sql.raw(String(i))}`), sql`, `)}
        from ${FROM} where ${where}`,
  );
  const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));
  return {
    n: toInt(s?.n),
    p25: num(s?.p25),
    median: num(s?.p50),
    p75: num(s?.p75),
    histogram: bins.map(([, , label], i) => ({ label, count: toInt(h[0]?.[`b${i}`]) })),
  };
}

export const AGE_BUCKETS = ["0–14d", "15–30d", "31–60d", "61–90d", "90d+", "Unknown"] as const;

/** Open opportunities by stage × time in stage. Without a verified stage entry the age is "Unknown". */
export async function stageAging(db: Db, f: Filters, scope: SalespersonScope) {
  const age = sql`(now()::date - (o.stage_entered_at at time zone ${f.tz})::date)`;
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select coalesce(s.name, '(no stage)') as stage, s.position,
          case when o.stage_entered_at is null then 'Unknown'
               when ${age} <= 14 then '0–14d' when ${age} <= 30 then '15–30d'
               when ${age} <= 60 then '31–60d' when ${age} <= 90 then '61–90d' else '90d+' end as bucket,
          count(*)::int as n, coalesce(sum(o.value_cents), 0)::bigint as cents
        from ${FROM} left join sales_stages s on s.id = o.stage_id
        where ${baseWhere(f, scope)} and ${OPEN}
        group by 1, 2, 3 order by s.position nulls last`,
  );
  const stages = [...new Map(r.map((x) => [String(x.stage), toIntOrNull(x.position)])).entries()]
    .sort((a, b) => (a[1] ?? 999) - (b[1] ?? 999))
    .map(([s]) => s);
  const cell = (stage: string, bucket: string) => {
    const x = r.find((y) => y.stage === stage && y.bucket === bucket);
    return { count: toInt(x?.n), cents: toInt(x?.cents) };
  };
  return { stages, buckets: AGE_BUCKETS, cell: Object.fromEntries(stages.map((s) => [s, Object.fromEntries(AGE_BUCKETS.map((b) => [b, cell(s, b)]))])) };
}

export const MIN_TRANSITIONS_FOR_HISTORY = 50;

/** Counts of verified (webhook) stage moves. Only meaningful once enough history exists. */
export async function transitionHistory(db: Db, scope: SalespersonScope) {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select coalesce(t.previous_stage_name, '(unknown)') as from_stage, coalesce(t.new_stage_name, '(unknown)') as to_stage,
          count(*)::int as n, min(t.transitioned_at) as first_at
        from stage_transitions t join opportunities o on o.id = t.opportunity_id
        where t.source = 'webhook' ${scope === "all" ? sql`` : sql`and ${inList(sql`o.salesperson_id`, scope)}`}
        group by 1, 2 order by n desc`,
  );
  const total = r.reduce((s, x) => s + toInt(x.n), 0);
  const firstAt = r.reduce<Date | null>((m, x) => {
    const d = x.first_at ? new Date(String(x.first_at)) : null;
    return d && (!m || d < m) ? d : m;
  }, null);
  return { total, since: firstAt?.toISOString() ?? null, rows: r.map((x) => ({ from: String(x.from_stage), to: String(x.to_stage), count: toInt(x.n) })) };
}

/* ------------------------------ targets ------------------------------ */

export async function targetForMonth(db: Db, scope: SalespersonScope, monthStart: string, monthEnd: string) {
  const r = await db
    .select({ total: sql<string>`coalesce(sum(${salesTargets.targetCents}), 0)`, n: sql<number>`count(*)::int` })
    .from(salesTargets)
    .where(
      and(
        gte(salesTargets.periodStart, monthStart),
        lte(salesTargets.periodEnd, monthEnd),
        scope === "all" ? sql`true` : inList(sql`${salesTargets.salespersonId}`, scope),
      ),
    );
  const n = toInt(r[0]?.n);
  return n ? toInt(r[0]?.total) : null;
}

export async function wonInRange(db: Db, scope: SalespersonScope, start: Date, end: Date, includeArchived: boolean, tz: string) {
  const f = { start, end, tz, stageIds: [], jobTypeIds: [], leadSourceIds: [] };
  const [r] = await rows<Record<string, unknown>>(
    db,
    sql`select coalesce(sum(o.value_cents), 0)::bigint as cents, count(*)::int as n from ${FROM}
        where ${baseWhere(f, scope)} and ${closedIn("won", f, includeArchived)}`,
  );
  return { cents: toInt(r?.cents), count: toInt(r?.n) };
}

/* ------------------------------ sync status ------------------------------ */

export async function getSyncStatus(db: Db) {
  const [lastSuccess] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.status, "succeeded"))
    .orderBy(desc(syncRuns.completedAt))
    .limit(1);
  const recentRuns = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(15);
  const counts = await rows<{ status: string; n: unknown }>(
    db,
    sql`select processing_status as status, count(*)::int as n from webhook_events group by 1`,
  );
  const [lastEvent] = await db.select({ receivedAt: webhookEvents.receivedAt }).from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(1);
  const problems = await db
    .select({
      id: webhookEvents.id,
      eventType: webhookEvents.eventType,
      status: webhookEvents.processingStatus,
      attempts: webhookEvents.attempts,
      errorMessage: webhookEvents.errorMessage,
      receivedAt: webhookEvents.receivedAt,
      nextAttemptAt: webhookEvents.nextAttemptAt,
    })
    .from(webhookEvents)
    .where(sql`${webhookEvents.processingStatus} in ('failed','dead')`)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(20);
  const [dataAsOf] = await rows<{ t: unknown }>(db, sql`select max(last_synced_at) as t from opportunities`);
  return {
    lastSuccessfulSync: lastSuccess ? { type: lastSuccess.syncType, completedAt: lastSuccess.completedAt?.toISOString() ?? null } : null,
    dataAsOf: dataAsOf?.t ? new Date(String(dataAsOf.t)).toISOString() : null,
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      syncType: r.syncType,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      recordsProcessed: r.recordsProcessed,
      errorMessage: r.errorMessage,
    })),
    webhookCounts: Object.fromEntries(counts.map((c) => [c.status, toInt(c.n)])) as Record<string, number>,
    lastWebhookAt: lastEvent?.receivedAt.toISOString() ?? null,
    webhookProblems: problems.map((p) => ({ ...p, receivedAt: p.receivedAt.toISOString(), nextAttemptAt: p.nextAttemptAt?.toISOString() ?? null })),
  };
}
export type SyncStatus = Awaited<ReturnType<typeof getSyncStatus>>;

export async function activitySummary(db: Db, f: Filters, scope: SalespersonScope) {
  const [r] = await rows<Record<string, unknown>>(
    db,
    sql`select
          count(*) filter (where a.status = 'open' and ${OPEN})::int as open,
          count(*) filter (where a.status = 'open' and ${OPEN} and a.due_at < now())::int as overdue,
          count(*) filter (where a.completed_at >= ${f.start} and a.completed_at < ${f.end})::int as completed
        from activities a join opportunities o on o.id = a.opportunity_id left join customers c on c.id = o.customer_id
        where ${baseWhere(f, scope)} and a.removed_at is null`,
  );
  const byType = await rows<Record<string, unknown>>(
    db,
    sql`select a.type, count(*)::int as n from activities a join opportunities o on o.id = a.opportunity_id left join customers c on c.id = o.customer_id
        where ${baseWhere(f, scope)} and a.removed_at is null and a.completed_at >= ${f.start} and a.completed_at < ${f.end}
        group by 1 order by 2 desc`,
  );
  return {
    open: toInt(r?.open),
    overdue: toInt(r?.overdue),
    completed: toInt(r?.completed),
    completedByType: byType.map((x) => ({ type: String(x.type), count: toInt(x.n) })),
  };
}
