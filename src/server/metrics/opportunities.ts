import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { activities, stageTransitions, salesStages, salespeople } from "@/db/schema";
import { and_, inList, rows } from "@/db/sql";
import { toInt, toIntOrNull } from "@/lib/money";
import { canViewSalesperson, type SalespersonScope, type Viewer } from "@/server/authz";
import { LOCAL_DATE_RE, localRangeToUtc } from "@/lib/time";

const csvInts = z
  .string()
  .optional()
  .transform((s) => (s ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));

export const SORT_KEYS = ["name", "customer", "salesperson", "stage", "value", "jobType", "created", "changed", "age", "status"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const listParamsSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  status: z.enum(["pending", "won", "lost", "open"]).optional().catch(undefined),
  sp: csvInts.catch([]),
  stage: csvInts.catch([]),
  jobType: csvInts.catch([]),
  leadSource: csvInts.catch([]),
  closedFrom: z.string().regex(LOCAL_DATE_RE).optional().catch(undefined),
  closedTo: z.string().regex(LOCAL_DATE_RE).optional().catch(undefined),
  archived: z.enum(["include", "only"]).optional().catch(undefined),
  sort: z.enum(SORT_KEYS).catch("changed").default("changed"),
  dir: z.enum(["asc", "desc"]).catch("desc").default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).catch(25).default(25),
});
export type ListParams = z.infer<typeof listParamsSchema>;

export type OpportunityListRow = {
  id: number;
  pbId: string;
  number: string | null;
  name: string;
  customerName: string | null;
  salespersonId: number | null;
  salespersonName: string | null;
  stageName: string | null;
  status: "pending" | "won" | "lost";
  archived: boolean;
  valueCents: number | null;
  jobTypeName: string | null;
  leadSourceName: string | null;
  createdDate: string | null;
  closedAt: string | null;
  lastChangedAt: string | null;
  lastSyncedAt: string | null;
  ageDays: number | null;
};

const SORT_SQL: Record<SortKey, ReturnType<typeof sql>> = {
  name: sql`o.name`,
  customer: sql`c.name`,
  salesperson: sql`sp.name`,
  stage: sql`s.position`,
  value: sql`o.value_cents`,
  jobType: sql`jt.name`,
  created: sql`o.pb_created_date`,
  changed: sql`coalesce(o.last_changed_at, o.created_at)`,
  age: sql`o.pb_created_date`,
  status: sql`o.status`,
};

function listWhere(p: ListParams, scope: SalespersonScope, tz: string) {
  const closed = p.closedFrom && p.closedTo ? localRangeToUtc(p.closedFrom, p.closedTo, tz) : null;
  const like = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  return and_([
    sql`o.pb_missing_at is null`,
    scope === "all" ? (p.sp.length ? inList(sql`o.salesperson_id`, p.sp) : null) : inList(sql`o.salesperson_id`, scope),
    p.status === "open" ? sql`o.status = 'pending' and o.archived = false` : p.status ? sql`o.status = ${p.status}` : null,
    p.archived === "only" ? sql`o.archived = true` : p.archived === "include" ? null : sql`o.archived = false`,
    p.stage.length ? inList(sql`o.stage_id`, p.stage) : null,
    p.jobType.length ? inList(sql`o.job_type_id`, p.jobType) : null,
    p.leadSource.length ? inList(sql`c.lead_source_id`, p.leadSource) : null,
    closed ? sql`o.closed_at >= ${closed.start} and o.closed_at < ${closed.end}` : null,
    like ? sql`(o.name ilike ${like} or c.name ilike ${like} or o.number ilike ${like})` : null,
  ]);
}

const LIST_FROM = sql`opportunities o
  left join customers c on c.id = o.customer_id
  left join salespeople sp on sp.id = o.salesperson_id
  left join sales_stages s on s.id = o.stage_id
  left join job_types jt on jt.id = o.job_type_id
  left join lead_sources ls on ls.id = c.lead_source_id`;

function mapRow(x: Record<string, unknown>): OpportunityListRow {
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    id: toInt(x.id),
    pbId: String(x.pb_id),
    number: (x.number as string) ?? null,
    name: String(x.name),
    customerName: (x.customer_name as string) ?? null,
    salespersonId: toIntOrNull(x.salesperson_id),
    salespersonName: (x.sp_name as string) ?? null,
    stageName: (x.stage_name as string) ?? null,
    status: x.status as OpportunityListRow["status"],
    archived: Boolean(x.archived),
    valueCents: toIntOrNull(x.value_cents),
    jobTypeName: (x.job_type_name as string) ?? null,
    leadSourceName: (x.lead_source_name as string) ?? null,
    createdDate: x.pb_created_date ? String(x.pb_created_date).slice(0, 10) : null,
    closedAt: iso(x.closed_at),
    lastChangedAt: iso(x.last_changed_at),
    lastSyncedAt: iso(x.last_synced_at),
    ageDays: toIntOrNull(x.age_days),
  };
}

const LIST_COLS = sql`o.id, o.pb_id, o.number, o.name, c.name as customer_name, o.salesperson_id, sp.name as sp_name,
  s.name as stage_name, o.status, o.archived, o.value_cents, jt.name as job_type_name, ls.name as lead_source_name,
  o.pb_created_date, o.closed_at, o.last_changed_at, o.last_synced_at`;

export async function listOpportunities(db: Db, p: ListParams, scope: SalespersonScope, tz: string) {
  const where = listWhere(p, scope, tz);
  const dir = p.dir === "asc" ? sql`asc` : sql`desc`;
  const offset = (p.page - 1) * p.pageSize;
  const [data, [{ total }]] = await Promise.all([
    rows<Record<string, unknown>>(
      db,
      sql`select ${LIST_COLS}, (case when o.status = 'pending' then (now() at time zone ${tz})::date else (coalesce(o.closed_at, now()) at time zone ${tz})::date end) - o.pb_created_date as age_days
          from ${LIST_FROM} where ${where}
          order by ${SORT_SQL[p.sort]} ${dir} nulls last, o.id ${dir}
          limit ${p.pageSize} offset ${offset}`,
    ),
    rows<{ total: unknown }>(db, sql`select count(*)::int as total from ${LIST_FROM} where ${where}`),
  ]);
  return { rows: data.map(mapRow), total: toInt(total), page: p.page, pageSize: p.pageSize };
}

/** Streams every matching row in pages for CSV export (bounded memory). */
export async function* iterateOpportunities(db: Db, p: ListParams, scope: SalespersonScope, tz: string) {
  const where = listWhere(p, scope, tz);
  let lastId = 0;
  for (;;) {
    const batch = await rows<Record<string, unknown>>(
      db,
      sql`select ${LIST_COLS}, null as age_days from ${LIST_FROM} where ${where} and o.id > ${lastId} order by o.id limit 1000`,
    );
    if (!batch.length) return;
    for (const r of batch) yield mapRow(r);
    lastId = toInt(batch[batch.length - 1].id);
  }
}

export async function getOpportunityDetail(db: Db, id: number, viewer: Viewer) {
  const [row] = await rows<Record<string, unknown>>(
    db,
    sql`select ${LIST_COLS}, o.lead_temperature, o.completed_at, o.stage_entered_at, o.activities_synced_at, o.pb_missing_at,
          o.last_pb_event_at, lr.name as lost_reason_name, null as age_days
        from ${LIST_FROM} left join lost_reasons lr on lr.id = o.lost_reason_id
        where o.id = ${id}`,
  );
  if (!row) return null;
  const base = mapRow(row);
  // Authorization: same rule as list scope. A salesperson asking for someone else's
  // opportunity gets "not found" so ids cannot be probed.
  if (!canViewSalesperson(viewer, base.salespersonId)) return null;

  const [acts, transitions] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(eq(activities.opportunityId, id))
      .orderBy(asc(activities.dueAt)),
    db
      .select({
        id: stageTransitions.id,
        previousStageName: stageTransitions.previousStageName,
        newStageName: stageTransitions.newStageName,
        transitionedAt: stageTransitions.transitionedAt,
        source: stageTransitions.source,
        salespersonName: salespeople.name,
      })
      .from(stageTransitions)
      .leftJoin(salespeople, eq(salespeople.id, stageTransitions.salespersonId))
      .where(eq(stageTransitions.opportunityId, id))
      .orderBy(desc(stageTransitions.transitionedAt)),
  ]);
  const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
  return {
    ...base,
    leadTemperature: (row.lead_temperature as string) ?? null,
    lostReasonName: (row.lost_reason_name as string) ?? null,
    completedAt: iso(row.completed_at),
    stageEnteredAt: iso(row.stage_entered_at),
    activitiesSyncedAt: iso(row.activities_synced_at),
    pbMissingAt: iso(row.pb_missing_at),
    lastPbEventAt: iso(row.last_pb_event_at),
    activities: acts.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      status: a.status,
      dueDate: a.dueDate,
      beginTime: a.beginTime,
      dueAt: a.dueAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
      assignedUserName: a.assignedUserName,
      removed: a.removedAt !== null,
    })),
    transitions: transitions.map((t) => ({ ...t, transitionedAt: t.transitionedAt.toISOString() })),
  };
}
export type OpportunityDetail = NonNullable<Awaited<ReturnType<typeof getOpportunityDetail>>>;

export async function getFilterOptions(db: Db, scope: SalespersonScope) {
  const [sps, stages, jts, lss] = await Promise.all([
    db
      .select({ id: salespeople.id, name: salespeople.name, active: salespeople.active })
      .from(salespeople)
      .where(scope === "all" ? sql`true` : inList(sql`${salespeople.id}`, scope))
      .orderBy(desc(salespeople.active), asc(salespeople.name)),
    db.select({ id: salesStages.id, name: salesStages.name, status: salesStages.status }).from(salesStages).orderBy(sql`${salesStages.position} asc nulls last`, asc(salesStages.name)),
    rows<{ id: number; name: string }>(db, sql`select id, name from job_types order by name`),
    rows<{ id: number; name: string }>(db, sql`select id, name from lead_sources order by name`),
  ]);
  return { salespeople: sps, stages, jobTypes: jts.map((j) => ({ id: toInt(j.id), name: j.name })), leadSources: lss.map((l) => ({ id: toInt(l.id), name: l.name })) };
}
export type FilterOptions = Awaited<ReturnType<typeof getFilterOptions>>;

