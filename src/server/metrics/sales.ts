/**
 * Sales metrics. Definitions (also shown in the UI, see METRIC_DEFINITIONS):
 *
 *  Open pipeline     Sum of PB `revenue` over opportunities with status "pending" that are
 *                    not archived. Current state; not affected by the date range.
 *  Won Sales         Sum of `revenue` over status "won" opportunities whose `closed_at`
 *                    falls in the selected range (company time zone). Not accounting revenue.
 *  Lost value        Same, for status "lost".
 *  Win rate          won / (won + lost), both counted by `closed_at` in the same range.
 *  Avg won deal      Won Sales / number of won opportunities *that have a value*.
 *  Sales cycle       closed date (company tz) − PB created_date, in days, for won
 *                    opportunities closed in the range. Median is the headline number.
 *
 * Missing values: opportunities without `revenue` are excluded from sums and averages,
 * never treated as $0, and are counted separately so the UI can say so.
 * Won/lost opportunities without `closed_at` cannot be placed in a period and are
 * reported as a data-quality count.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/sql";
import { toInt, toIntOrNull } from "@/lib/money";
import type { SalespersonScope } from "@/server/authz";
import { baseWhere, closedIn, FROM, OPEN, type Filters, type GroupBy } from "./filters";

export type Amount = { count: number; valueCents: number; missingValue: number };

const amountCols = sql`count(*)::int as count, coalesce(sum(o.value_cents), 0)::bigint as value_cents, count(*) filter (where o.value_cents is null)::int as missing_value`;

function toAmount(r: Record<string, unknown> | undefined): Amount {
  return { count: toInt(r?.count), valueCents: toInt(r?.value_cents), missingValue: toInt(r?.missing_value) };
}

export function winRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : won / (won + lost);
}

/** Integer cents, rounded half up; null when there is nothing to average. */
export function averageCents(totalCents: number, n: number): number | null {
  if (n <= 0) return null;
  return Math.floor((totalCents * 2 + n) / (2 * n));
}

export type Kpis = {
  open: Amount;
  won: Amount;
  lost: Amount;
  winRate: number | null;
  avgWonCents: number | null;
  closedWithoutDate: number;
  medianCycleDays: number | null;
};

export async function getKpis(db: Db, f: Filters, scope: SalespersonScope, opts: { includeArchived: boolean }): Promise<Kpis> {
  const where = baseWhere(f, scope);
  const [open] = await rows<Record<string, unknown>>(db, sql`select ${amountCols} from ${FROM} where ${where} and ${OPEN}`);
  const [won] = await rows<Record<string, unknown>>(db, sql`select ${amountCols} from ${FROM} where ${where} and ${closedIn("won", f, opts.includeArchived)}`);
  const [lost] = await rows<Record<string, unknown>>(db, sql`select ${amountCols} from ${FROM} where ${where} and ${closedIn("lost", f, opts.includeArchived)}`);
  const [dq] = await rows<{ n: unknown }>(
    db,
    sql`select count(*)::int as n from ${FROM} where ${where} and o.status in ('won','lost') and o.closed_at is null`,
  );
  const [cycle] = await rows<{ median: unknown }>(
    db,
    sql`select percentile_cont(0.5) within group (order by ((o.closed_at at time zone ${f.tz})::date - o.pb_created_date)) as median
        from ${FROM} where ${where} and ${closedIn("won", f, opts.includeArchived)} and o.pb_created_date is not null`,
  );
  const w = toAmount(won);
  const l = toAmount(lost);
  return {
    open: toAmount(open),
    won: w,
    lost: l,
    winRate: winRate(w.count, l.count),
    avgWonCents: averageCents(w.valueCents, w.count - w.missingValue),
    closedWithoutDate: toInt(dq?.n),
    medianCycleDays: cycle?.median === null || cycle?.median === undefined ? null : Math.round(Number(cycle.median)),
  };
}

export type StageRow = Amount & { stageId: number | null; stageName: string; position: number | null };

export async function getPipelineByStage(db: Db, f: Filters, scope: SalespersonScope): Promise<StageRow[]> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select o.stage_id, coalesce(s.name, '(no stage)') as stage_name, s.position, ${amountCols}
        from ${FROM} left join sales_stages s on s.id = o.stage_id
        where ${baseWhere(f, scope)} and ${OPEN}
        group by o.stage_id, s.name, s.position
        order by s.position asc nulls last, s.name`,
  );
  return r.map((x) => ({ ...toAmount(x), stageId: toIntOrNull(x.stage_id), stageName: String(x.stage_name), position: toIntOrNull(x.position) }));
}

export type TrendPoint = { bucket: string; won: Amount; lost: Amount };

/** Won and lost by close period (company time zone), with empty periods filled in. */
export async function getTrend(db: Db, f: Filters, scope: SalespersonScope, opts: { includeArchived: boolean }): Promise<TrendPoint[]> {
  const unit = f.groupBy;
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select to_char(date_trunc(${unit}, o.closed_at at time zone ${f.tz}), 'YYYY-MM-DD') as bucket, o.status, ${amountCols}
        from ${FROM}
        where ${baseWhere(f, scope)} and o.status in ('won','lost') and o.closed_at >= ${f.start} and o.closed_at < ${f.end}
          ${opts.includeArchived ? sql`` : sql`and o.archived = false`}
        group by 1, 2 order by 1`,
  );
  const map = new Map<string, TrendPoint>();
  for (const b of buckets(f.from, f.to, unit)) map.set(b, { bucket: b, won: emptyAmount(), lost: emptyAmount() });
  for (const x of r) {
    const b = String(x.bucket);
    const p = map.get(b) ?? { bucket: b, won: emptyAmount(), lost: emptyAmount() };
    p[x.status === "won" ? "won" : "lost"] = toAmount(x);
    map.set(b, p);
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

const emptyAmount = (): Amount => ({ count: 0, valueCents: 0, missingValue: 0 });

/** Period starts between two local dates, matching Postgres date_trunc (ISO weeks start Monday). */
export function buckets(from: string, to: string, unit: GroupBy): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd));
  if (unit === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  else if (unit === "month") start.setUTCDate(1);
  else {
    start.setUTCDate(1);
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
  }
  const out: string[] = [];
  const end = to;
  const d = new Date(start);
  while (d.toISOString().slice(0, 10) <= end && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    if (unit === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + (unit === "month" ? 1 : 3));
  }
  return out;
}

export type SalespersonRow = {
  salespersonId: number;
  name: string;
  active: boolean;
  won: Amount;
  lost: Amount;
  open: Amount;
  winRate: number | null;
  avgWonCents: number | null;
  medianCycleDays: number | null;
  overdueActivities: number;
};

/** Per-salesperson scorecard; one query, grouped. */
export async function getSalespersonScorecard(
  db: Db,
  f: Filters,
  scope: SalespersonScope,
  opts: { includeArchived: boolean },
): Promise<SalespersonRow[]> {
  const where = baseWhere(f, scope);
  const won = closedIn("won", f, opts.includeArchived);
  const lost = closedIn("lost", f, opts.includeArchived);
  const r = await rows<Record<string, unknown>>(
    db,
    sql`with agg as (
          select o.salesperson_id,
            count(*) filter (where ${won})::int as won_count,
            coalesce(sum(o.value_cents) filter (where ${won}), 0)::bigint as won_value,
            count(*) filter (where ${won} and o.value_cents is null)::int as won_missing,
            count(*) filter (where ${lost})::int as lost_count,
            coalesce(sum(o.value_cents) filter (where ${lost}), 0)::bigint as lost_value,
            count(*) filter (where ${lost} and o.value_cents is null)::int as lost_missing,
            count(*) filter (where ${OPEN})::int as open_count,
            coalesce(sum(o.value_cents) filter (where ${OPEN}), 0)::bigint as open_value,
            count(*) filter (where ${OPEN} and o.value_cents is null)::int as open_missing,
            percentile_cont(0.5) within group (order by ((o.closed_at at time zone ${f.tz})::date - o.pb_created_date))
              filter (where ${won} and o.pb_created_date is not null) as median_cycle
          from ${FROM} where ${where} group by o.salesperson_id
        ),
        overdue as (
          select o.salesperson_id, count(*)::int as n
          from activities a join opportunities o on o.id = a.opportunity_id left join customers c on c.id = o.customer_id
          where ${where} and ${OPEN} and a.status = 'open' and a.removed_at is null and a.due_at < now()
          group by o.salesperson_id
        )
        select sp.id, sp.name, sp.active, agg.*, coalesce(overdue.n, 0) as overdue
        from salespeople sp
        left join agg on agg.salesperson_id = sp.id
        left join overdue on overdue.salesperson_id = sp.id
        where ${scope === "all" ? sql`(sp.active or agg.salesperson_id is not null)` : sql`sp.id in (${sql.join(scope.map((i) => sql`${i}`), sql`, `)})`}
        order by sp.name`,
  );
  return r
    .map((x) => {
      const w = { count: toInt(x.won_count), valueCents: toInt(x.won_value), missingValue: toInt(x.won_missing) };
      const l = { count: toInt(x.lost_count), valueCents: toInt(x.lost_value), missingValue: toInt(x.lost_missing) };
      return {
        salespersonId: toInt(x.id),
        name: String(x.name),
        active: Boolean(x.active),
        won: w,
        lost: l,
        open: { count: toInt(x.open_count), valueCents: toInt(x.open_value), missingValue: toInt(x.open_missing) },
        winRate: winRate(w.count, l.count),
        avgWonCents: averageCents(w.valueCents, w.count - w.missingValue),
        medianCycleDays: x.median_cycle === null || x.median_cycle === undefined ? null : Math.round(Number(x.median_cycle)),
        overdueActivities: toInt(x.overdue),
      };
    })
    .filter((row) => row.active || row.won.count + row.lost.count + row.open.count > 0);
}

export const METRIC_DEFINITIONS: Record<string, string> = {
  openPipeline:
    "Sum of PB expected value (revenue) for opportunities with status Pending that are not archived. Reflects the current state, not the date range.",
  wonSales:
    "Sum of expected value for opportunities marked Won whose close date falls in the selected range (company time zone). This is won sales, not recognized accounting revenue.",
  lostValue: "Sum of expected value for opportunities marked Lost whose close date falls in the selected range.",
  activeOpportunities: "Count of Pending, non-archived opportunities.",
  avgWonDeal: "Won Sales ÷ number of won opportunities that have a value. Opportunities without a value are excluded, not counted as $0.",
  winRate: "Won ÷ (Won + Lost), both counted by close date within the selected range. Open opportunities are excluded.",
  needsAttention: "Open opportunities matching at least one action rule (see the priority queue for the rule that fired).",
  salesCycle: "Median days from PB created date to close date, for won opportunities closed in the range.",
  pipelineCoverage: "Open pipeline ÷ this month's sales target. Only shown when a target is configured.",
  stageAge:
    "Days since a verified entry into the current stage, from an opportunity.stage_updated webhook. Unknown when no such event has been received; creation date is never substituted.",
};
