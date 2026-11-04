import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/sql";
import { toInt, toIntOrNull } from "@/lib/money";
import type { SalespersonScope } from "@/server/authz";
import type { Thresholds } from "@/server/settings";
import { baseWhere, FROM, OPEN } from "./filters";

export type ReasonCode = "overdue_activity" | "no_open_activity" | "high_value_no_change" | "stage_aging" | "no_recent_completed_activity";

export type Reason = { code: ReasonCode; severity: 1 | 2 | 3; label: string };

export type PriorityItem = {
  opportunityId: number;
  name: string;
  customerName: string | null;
  salespersonId: number | null;
  salespersonName: string | null;
  stageName: string | null;
  valueCents: number | null;
  reasons: Reason[];
  score: number;
};

/**
 * Transparent rules over open opportunities. Each reason states exactly what the data
 * shows. "No observed PB change" (record edits seen by this system) and "no completed
 * activity" (sales activities logged in PB) are separate rules — neither implies the
 * customer was not contacted.
 */
export const RULE_DESCRIPTIONS: Record<ReasonCode, string> = {
  overdue_activity: "An open PB activity on the opportunity is past its due date.",
  no_open_activity: "Activities were synced from PB and none is open, so no follow-up is scheduled in PB.",
  high_value_no_change: "Value at or above the high-value threshold and no change to the PB record has been observed for the configured number of days.",
  stage_aging: "In the current stage longer than the threshold, based on a verified stage-change webhook.",
  no_recent_completed_activity: "No activity has been marked complete in PB within the configured number of days.",
};

const DAY = 86_400_000;

export async function getPriorityQueue(
  db: Db,
  scope: SalespersonScope,
  t: Thresholds,
  now: Date = new Date(),
): Promise<PriorityItem[]> {
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select o.id, o.name, o.value_cents, o.salesperson_id, sp.name as sp_name, c.name as customer_name, s.name as stage_name,
          o.last_changed_at, o.created_at, o.stage_entered_at, o.activities_synced_at,
          count(a.id) filter (where a.status = 'open' and a.removed_at is null and a.due_at < ${now})::int as overdue,
          count(a.id) filter (where a.status = 'open' and a.removed_at is null and (a.due_at >= ${now} or a.due_at is null))::int as upcoming,
          min(a.due_at) filter (where a.status = 'open' and a.removed_at is null and a.due_at < ${now}) as oldest_overdue,
          max(a.completed_at) filter (where a.removed_at is null) as last_completed
        from ${FROM}
        left join salespeople sp on sp.id = o.salesperson_id
        left join sales_stages s on s.id = o.stage_id
        left join activities a on a.opportunity_id = o.id
        where ${baseWhere({ stageIds: [], jobTypeIds: [], leadSourceIds: [] }, scope)} and ${OPEN}
        group by o.id, sp.name, c.name, s.name`,
  );

  const items: PriorityItem[] = [];
  for (const x of r) {
    const reasons: Reason[] = [];
    const overdue = toInt(x.overdue);
    const upcoming = toInt(x.upcoming);
    const synced = x.activities_synced_at ? new Date(String(x.activities_synced_at)) : null;
    const value = toIntOrNull(x.value_cents);
    const days = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY);

    if (overdue > 0) {
      const oldest = new Date(String(x.oldest_overdue));
      reasons.push({ code: "overdue_activity", severity: 3, label: `${overdue} overdue ${overdue === 1 ? "activity" : "activities"} (oldest ${days(oldest)}d overdue)` });
    }
    if (synced && overdue === 0 && upcoming === 0) {
      reasons.push({ code: "no_open_activity", severity: 2, label: "No follow-up scheduled in PB" });
    }
    if (value !== null && value >= t.highValueCents) {
      const changed = x.last_changed_at ? new Date(String(x.last_changed_at)) : null;
      const tracked = new Date(String(x.created_at));
      const ref = changed ?? tracked;
      if (days(ref) >= t.highValueStaleDays) {
        reasons.push({
          code: "high_value_no_change",
          severity: 2,
          label: changed ? `High value, no PB record change seen in ${days(ref)}d` : `High value, no PB record change seen since tracking began ${days(ref)}d ago`,
        });
      }
    }
    if (x.stage_entered_at) {
      const d = days(new Date(String(x.stage_entered_at)));
      if (d >= t.stageAgingDays) reasons.push({ code: "stage_aging", severity: 2, label: `In ${x.stage_name ?? "stage"} for ${d}d` });
    }
    if (synced) {
      const last = x.last_completed ? new Date(String(x.last_completed)) : null;
      if (!last) {
        reasons.push({ code: "no_recent_completed_activity", severity: 1, label: "No completed activity recorded in PB" });
      } else if (days(last) >= t.noRecentActivityDays) {
        reasons.push({ code: "no_recent_completed_activity", severity: 1, label: `Last completed activity recorded ${days(last)}d ago` });
      }
    }
    // The weakest rule alone is informational; surface it only alongside another rule.
    const actionable = reasons.filter((rs) => rs.severity > 1);
    if (!actionable.length) continue;

    const score = reasons.reduce((s, rs) => s + rs.severity * 10, 0) + Math.min(10, Math.floor((value ?? 0) / 1_000_000));
    items.push({
      opportunityId: toInt(x.id),
      name: String(x.name),
      customerName: (x.customer_name as string) ?? null,
      salespersonId: toIntOrNull(x.salesperson_id),
      salespersonName: (x.sp_name as string) ?? null,
      stageName: (x.stage_name as string) ?? null,
      valueCents: value,
      reasons: reasons.sort((a, b) => b.severity - a.severity),
      score,
    });
  }
  return items.sort((a, b) => b.score - a.score || (b.valueCents ?? 0) - (a.valueCents ?? 0));
}

/** Open PB activities on the scope's open opportunities: overdue first, then upcoming. */
export async function getOpenActivities(db: Db, scope: SalespersonScope, opts: { horizonDays?: number; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const horizon = new Date(now.getTime() + (opts.horizonDays ?? 14) * DAY);
  const r = await rows<Record<string, unknown>>(
    db,
    sql`select a.id, a.title, a.type, a.due_at, a.due_date, a.begin_time, o.id as opp_id, o.name as opp_name
        from activities a join opportunities o on o.id = a.opportunity_id left join customers c on c.id = o.customer_id
        where ${baseWhere({ stageIds: [], jobTypeIds: [], leadSourceIds: [] }, scope)} and ${OPEN}
          and a.status = 'open' and a.removed_at is null and (a.due_at is null or a.due_at <= ${horizon})
        order by a.due_at asc nulls last
        limit ${opts.limit ?? 15}`,
  );
  return r.map((x) => ({
    id: toInt(x.id),
    title: String(x.title),
    type: String(x.type),
    dueAt: x.due_at ? new Date(String(x.due_at)).toISOString() : null,
    dueDate: x.due_date ? String(x.due_date).slice(0, 10) : null,
    beginTime: (x.begin_time as string) ?? null,
    opportunityId: toInt(x.opp_id),
    opportunityName: String(x.opp_name),
    overdue: x.due_at ? new Date(String(x.due_at)) < now : false,
  }));
}
