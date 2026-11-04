import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { pageContext } from "@/server/page";
import { getOpportunityDetail } from "@/server/metrics/opportunities";
import { PageHeader, Section } from "@/components/kpi-card";
import { StageTimeline } from "@/components/stage-timeline";
import { StatusBadge } from "@/components/opportunity-table";
import { formatCents } from "@/lib/money";
import { formatDateTime, formatLocalDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Opportunity" };

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const { viewer, db, tz } = await pageContext();
  const o = await getOpportunityDetail(db, n, viewer);
  if (!o) notFound();

  const dateRows: [string, React.ReactNode][] = [
    ["Created in PB", formatLocalDate(o.createdDate)],
    ["Closed", o.closedAt ? formatDateTime(o.closedAt, tz) : "—"],
    ["Job completed", o.completedAt ? formatDateTime(o.completedAt, tz) : "—"],
    ["In current stage since", o.stageEnteredAt ? formatDateTime(o.stageEnteredAt, tz) : <span title="No verified stage-change webhook for the current stage">Unknown</span>],
    ["Last change observed", o.lastChangedAt ? formatRelative(o.lastChangedAt) : "Not observed since tracking began"],
    ["Last synced from PB", o.lastSyncedAt ? formatDateTime(o.lastSyncedAt, tz) : "—"],
  ];

  return (
    <>
      <Link href="/opportunities" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Opportunities
      </Link>
      <PageHeader
        title={o.name}
        description={[o.number ? `Job #${o.number}` : null, o.customerName].filter(Boolean).join(" · ")}
      >
        <StatusBadge status={o.status} archived={o.archived} />
      </PageHeader>
      {o.pbMissingAt && (
        <div role="alert" className="mb-4 rounded-lg border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-sm">
          PB no longer returns this opportunity (since {formatDateTime(o.pbMissingAt, tz)}). It may have been deleted. It is excluded from metrics.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Summary" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Value" value={o.valueCents === null ? "No value in PB" : formatCents(o.valueCents, { exact: true })} />
            <Field label="Stage" value={o.stageName ?? "—"} />
            <Field label="Salesperson" value={o.salespersonName ?? "Unassigned"} />
            <Field label="Customer" value={o.customerName ?? "—"} />
            <Field label="Job type" value={o.jobTypeName ?? "—"} />
            <Field label="Lead source" value={o.leadSourceName ?? "—"} />
            <Field label="Temperature" value={o.leadTemperature ? o.leadTemperature[0].toUpperCase() + o.leadTemperature.slice(1) : "—"} />
            {o.status === "lost" && <Field label="Lost reason" value={o.lostReasonName ?? "Not recorded"} />}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Precise Builder is the source of truth for this record. Its API documentation does not define a web link format, so this page does not link to PB directly; search PB for job #{o.number ?? "—"}.
          </p>
        </Section>
        <Section title="Important dates">
          <dl className="space-y-2 text-sm">
            {dateRows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Activities" description={o.activitiesSyncedAt ? `Synced ${formatRelative(o.activitiesSyncedAt)}` : "Not synced yet for this opportunity"}>
          {o.activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities recorded in PB. This does not mean the customer was not contacted.</p>
          ) : (
            <ul className="divide-y text-sm">
              {o.activities.map((a) => {
                const overdue = a.status === "open" && a.dueAt && new Date(a.dueAt) < new Date();
                return (
                  <li key={a.id} className={`flex items-start justify-between gap-3 py-2 ${a.removed ? "opacity-50" : ""}`}>
                    <div>
                      <div className={a.status === "completed" ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}>{a.title}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {a.type}
                        {a.assignedUserName ? ` · ${a.assignedUserName}` : ""}
                        {a.removed ? " · no longer in PB" : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={overdue ? "font-medium text-status-critical" : "text-muted-foreground"}>
                        {overdue ? "Overdue · " : "Due "}
                        {a.dueDate ? formatLocalDate(a.dueDate) : "—"}
                        {a.beginTime ? ` ${a.beginTime}` : ""}
                      </div>
                      {a.completedAt && <div className="text-muted-foreground">Done {formatDateTime(a.completedAt, tz)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section title="Stage history" description="From PB stage-change webhooks (exact) and reconciliation (approximate)">
          <StageTimeline entries={o.transitions} tz={tz} />
        </Section>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
