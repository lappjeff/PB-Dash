import { formatDateTime } from "@/lib/format";
import { EmptyState } from "./kpi-card";

export type TimelineEntry = {
  id: number;
  previousStageName: string | null;
  newStageName: string | null;
  transitionedAt: string;
  source: "webhook" | "reconciliation";
  salespersonName: string | null;
};

/** Stage history. Webhook entries are exact; reconciliation entries were detected later and their time is approximate. */
export function StageTimeline({ entries, tz }: { entries: TimelineEntry[]; tz: string }) {
  if (!entries.length) {
    return (
      <EmptyState title="No stage history recorded yet">
        History is collected from PB stage-change webhooks from the time this app went live. Earlier moves are not reconstructed.
      </EmptyState>
    );
  }
  return (
    <ol className="relative ml-1.5 border-l pl-5">
      {entries.map((e) => (
        <li key={e.id} className="relative pb-4 last:pb-0">
          <span className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-2 ring-card ${e.source === "webhook" ? "bg-[var(--viz-series-1)]" : "border border-dashed border-muted-foreground bg-card"}`} aria-hidden />
          <div className="text-sm">
            <span className="text-muted-foreground">{e.previousStageName ?? "?"}</span> → <span className="font-medium">{e.newStageName ?? "?"}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {e.source === "webhook" ? formatDateTime(e.transitionedAt, tz) : `Detected by reconciliation around ${formatDateTime(e.transitionedAt, tz)} (exact time unknown)`}
            {e.salespersonName ? ` · ${e.salespersonName}` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}
