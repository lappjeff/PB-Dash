import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { and_, inList } from "@/db/sql";
import type { SalespersonScope } from "@/server/authz";
import { DATE_PRESETS, LOCAL_DATE_RE, localRangeToUtc, presetRange, type DatePresetKey, type LocalDate } from "@/lib/time";

const csvInts = z
  .string()
  .optional()
  .transform((s) =>
    (s ?? "")
      .split(",")
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

export const groupBySchema = z.enum(["week", "month", "quarter"]);
export type GroupBy = z.infer<typeof groupBySchema>;

export const filterParamsSchema = z.object({
  preset: z.enum(DATE_PRESETS.map((p) => p.key) as [DatePresetKey, ...DatePresetKey[]]).optional().catch(undefined),
  from: z.string().regex(LOCAL_DATE_RE).optional().catch(undefined),
  to: z.string().regex(LOCAL_DATE_RE).optional().catch(undefined),
  sp: csvInts.catch([]),
  stage: csvInts.catch([]),
  jobType: csvInts.catch([]),
  leadSource: csvInts.catch([]),
  group: groupBySchema.catch("month").default("month"),
});

export type Filters = {
  preset: DatePresetKey | null;
  from: LocalDate;
  to: LocalDate;
  /** UTC half-open range for the selected local dates. */
  start: Date;
  end: Date;
  salespersonIds: number[];
  stageIds: number[];
  jobTypeIds: number[];
  leadSourceIds: number[];
  groupBy: GroupBy;
  tz: string;
};

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export function parseFilters(sp: SearchParams, tz: string, defaultPreset: DatePresetKey = "ytd", now = new Date()): Filters {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, first(v)]));
  const p = filterParamsSchema.parse(flat);
  let from: LocalDate;
  let to: LocalDate;
  let preset: DatePresetKey | null = null;
  if (p.from && p.to && p.from <= p.to) {
    from = p.from;
    to = p.to;
  } else {
    preset = p.preset ?? defaultPreset;
    ({ from, to } = presetRange(preset, tz, now));
  }
  const { start, end } = localRangeToUtc(from, to, tz);
  return {
    preset,
    from,
    to,
    start,
    end,
    salespersonIds: p.sp,
    stageIds: p.stage,
    jobTypeIds: p.jobType,
    leadSourceIds: p.leadSource,
    groupBy: p.group,
    tz,
  };
}

/**
 * Conditions shared by every metric, over `opportunities o left join customers c`.
 * The salesperson restriction comes from the authorization scope, never from the
 * raw request.
 */
export function baseWhere(f: Pick<Filters, "stageIds" | "jobTypeIds" | "leadSourceIds">, scope: SalespersonScope): SQL {
  return and_([
    sql`o.pb_missing_at is null`,
    scope === "all" ? null : inList(sql`o.salesperson_id`, scope),
    f.stageIds.length ? inList(sql`o.stage_id`, f.stageIds) : null,
    f.jobTypeIds.length ? inList(sql`o.job_type_id`, f.jobTypeIds) : null,
    f.leadSourceIds.length ? inList(sql`c.lead_source_id`, f.leadSourceIds) : null,
  ]);
}

/** Open = PB status "pending" and not archived. Won/lost are PB's terminal statuses. */
export const OPEN = sql`o.status = 'pending' and o.archived = false`;

export function closedIn(status: "won" | "lost", f: Pick<Filters, "start" | "end">, includeArchived: boolean): SQL {
  return and_([
    sql`o.status = ${status}`,
    sql`o.closed_at >= ${f.start} and o.closed_at < ${f.end}`,
    includeArchived ? null : sql`o.archived = false`,
  ]);
}

export const FROM = sql`opportunities o left join customers c on c.id = o.customer_id`;

export function filtersToSearch(f: Filters, overrides: Record<string, string | null> = {}) {
  const q = new URLSearchParams();
  if (f.preset) q.set("preset", f.preset);
  else {
    q.set("from", f.from);
    q.set("to", f.to);
  }
  if (f.salespersonIds.length) q.set("sp", f.salespersonIds.join(","));
  if (f.stageIds.length) q.set("stage", f.stageIds.join(","));
  if (f.jobTypeIds.length) q.set("jobType", f.jobTypeIds.join(","));
  if (f.leadSourceIds.length) q.set("leadSource", f.leadSourceIds.join(","));
  if (f.groupBy !== "month") q.set("group", f.groupBy);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  return q.toString();
}
