import Link from "next/link";
import { AlertCircle, CalendarClock, CalendarX, Clock, Hourglass } from "lucide-react";
import { formatCents } from "@/lib/money";
import type { PriorityItem, ReasonCode } from "@/server/metrics/priority";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "./kpi-card";

const ICON: Record<ReasonCode, typeof AlertCircle> = {
  overdue_activity: AlertCircle,
  no_open_activity: CalendarX,
  high_value_no_change: Clock,
  stage_aging: Hourglass,
  no_recent_completed_activity: CalendarClock,
};

/** Opportunities needing action, with the exact rule(s) that flagged each. */
export function PriorityQueue({ items, limit = 12, showOwner = false }: { items: PriorityItem[]; limit?: number; showOwner?: boolean }) {
  if (!items.length) return <EmptyState title="Nothing needs attention">No open opportunity matches an action rule right now.</EmptyState>;
  return (
    <ul className="divide-y">
      {items.slice(0, limit).map((it) => (
        <li key={it.opportunityId} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <Link href={`/opportunities/${it.opportunityId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
              {it.name}
            </Link>
            <span className="shrink-0 text-sm tabular">{formatCents(it.valueCents)}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {[it.customerName, it.stageName, showOwner ? it.salespersonName : null].filter(Boolean).join(" · ")}
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {it.reasons.map((r) => {
              const Icon = ICON[r.code];
              return (
                <li
                  key={r.code}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${r.severity === 3 ? "border-status-critical/40 text-foreground" : "text-muted-foreground"}`}
                >
                  <Icon className={`size-3 ${r.severity === 3 ? "text-status-critical" : ""}`} aria-hidden />
                  {r.label}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
      {items.length > limit && <li className="pt-2 text-xs text-muted-foreground">+ {items.length - limit} more</li>}
    </ul>
  );
}

export type UpcomingActivity = {
  id: number;
  title: string;
  type: string;
  dueAt: string | null;
  dueDate: string | null;
  beginTime: string | null;
  opportunityId: number;
  opportunityName: string;
  overdue: boolean;
};

export function ActivityQueue({ items, tz }: { items: UpcomingActivity[]; tz: string }) {
  if (!items.length) return <EmptyState title="No open activities">Nothing is scheduled in PB for your open opportunities.</EmptyState>;
  return (
    <ul className="divide-y">
      {items.map((a) => (
        <li key={a.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
          <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${a.overdue ? "bg-status-critical" : "bg-muted-foreground/40"}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{a.title}</div>
            <Link href={`/opportunities/${a.opportunityId}`} className="truncate text-xs text-muted-foreground hover:underline">
              {a.opportunityName}
            </Link>
          </div>
          <div className="shrink-0 text-right text-xs">
            <div className={a.overdue ? "font-medium text-status-critical" : "text-muted-foreground"}>
              {a.overdue ? "Overdue · " : ""}
              {a.beginTime && a.dueAt ? formatDateTime(a.dueAt, tz) : a.dueDate}
            </div>
            <div className="text-muted-foreground capitalize">{a.type}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
