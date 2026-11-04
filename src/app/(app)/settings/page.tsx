import type { Metadata } from "next";
import { asc, desc, eq, sql } from "drizzle-orm";
import { pageContext } from "@/server/page";
import { isAdmin } from "@/server/authz";
import { salespeople, salesTargets, users } from "@/db/schema";
import { rows } from "@/db/sql";
import { getSyncStatus } from "@/server/metrics/analytics";
import { isPbConfigured } from "@/server/pb";
import { authMode } from "@/server/auth";
import { appMode, env, isClerkConfigured, webhookSecrets } from "@/env";
import { PageHeader, Section } from "@/components/kpi-card";
import { Forbidden } from "@/components/pages/forbidden";
import { formatDateTime, formatRelative } from "@/lib/format";
import { todayLocal } from "@/lib/time";
import { ThresholdsForm, TargetsForm, UserLinkRow, PbUserMappingRow, SyncControls } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { viewer, db, tz, thresholds } = await pageContext();
  if (!isAdmin(viewer)) return <Forbidden />;
  const month = /^\d{4}-\d{2}$/.test((await searchParams).month ?? "") ? (await searchParams).month! : todayLocal(tz).slice(0, 7);

  const [status, sps, appUsers, targets, pbUsers] = await Promise.all([
    getSyncStatus(db),
    db.select().from(salespeople).orderBy(desc(salespeople.active), asc(salespeople.name)),
    db.select().from(users).orderBy(desc(users.role), asc(users.name)),
    db.select().from(salesTargets).where(eq(salesTargets.periodStart, `${month}-01`)),
    rows<{ id: string; name: string }>(db, sql`select distinct assigned_user_pb_id as id, assigned_user_name as name from activities where assigned_user_pb_id is not null order by 2`),
  ]);
  const demo = appMode() === "demo";
  const webhookUrl = `${env().NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "https://<your-app>"}/api/webhooks/precise-builder`;
  const checks: [string, boolean, string][] = [
    ["Database", appMode() !== "misconfigured", demo ? "Embedded demo database (PGlite)" : "Neon PostgreSQL"],
    ["Precise Builder API", isPbConfigured(), demo ? "Fixture client (no network)" : isPbConfigured() ? "Base URL and API key set" : "Set PRECISE_BUILDER_BASE_URL and PRECISE_BUILDER_API_KEY"],
    ["Webhook signing secret", demo || webhookSecrets().length > 0, demo ? "Demo secret" : webhookSecrets().length ? `${webhookSecrets().length} secret(s) configured` : "Set PRECISE_BUILDER_WEBHOOK_SECRET"],
    ["Cron secret", demo || Boolean(env().CRON_SECRET), env().CRON_SECRET ? "Configured" : demo ? "Not needed in demo" : "Set CRON_SECRET (16+ chars)"],
    ["Authentication", authMode() !== "none", isClerkConfigured() ? "Clerk" : demo ? "Demo user switcher (no sign-in)" : "Clerk keys missing"],
  ];

  return (
    <>
      <PageHeader title="Settings" description="Integration status, targets, thresholds and user links. Secrets are never displayed." />
      <div className="grid gap-4">
        <Section title="Precise Builder integration">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {checks.map(([label, ok, note]) => (
              <li key={label} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${ok ? "bg-status-good" : "bg-status-critical"}`} aria-hidden />
                <div>
                  <div className="font-medium">
                    {label} <span className="sr-only">{ok ? "OK" : "Needs setup"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{note}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs">
            <div className="text-muted-foreground">Webhook endpoint to register in PB (Settings → Integrations → REST API → Webhooks):</div>
            <code className="mt-1 block break-all font-mono text-foreground">{webhookUrl}</code>
            <div className="mt-1 text-muted-foreground">Subscribe to: customer.created, customer.updated, opportunity.created, opportunity.stage_updated, job.updated, activity.created, activity.completed.</div>
          </div>
        </Section>

        <Section title="Synchronization" description={status.lastSuccessfulSync ? `Last successful ${status.lastSuccessfulSync.type} sync ${formatRelative(status.lastSuccessfulSync.completedAt!)}` : "No successful sync yet"}>
          <div id="sync" className="space-y-4">
            <SyncControls demo={demo} />
            <div className="grid gap-3 sm:grid-cols-5">
              {(["pending", "processed", "ignored", "failed", "dead"] as const).map((s) => (
                <div key={s} className="rounded-lg border p-3">
                  <div className={`text-lg font-semibold tabular ${(s === "failed" || s === "dead") && status.webhookCounts[s] ? "text-status-critical" : ""}`}>{status.webhookCounts[s] ?? 0}</div>
                  <div className="text-xs text-muted-foreground capitalize">{s === "dead" ? "gave up (dead)" : s} webhooks</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Last webhook received: {status.lastWebhookAt ? formatDateTime(status.lastWebhookAt, tz) : "never"}</p>
            {status.webhookProblems.length > 0 && (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Event</th>
                      <th className="px-3 py-1.5 text-left font-medium">Status</th>
                      <th className="px-3 py-1.5 text-right font-medium">Attempts</th>
                      <th className="px-3 py-1.5 text-left font-medium">Error</th>
                      <th className="px-3 py-1.5 text-left font-medium">Next retry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.webhookProblems.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{p.eventType}</td>
                        <td className="px-3 py-1.5">{p.status}</td>
                        <td className="px-3 py-1.5 text-right tabular">{p.attempts}</td>
                        <td className="max-w-md truncate px-3 py-1.5" title={p.errorMessage ?? ""}>{p.errorMessage}</td>
                        <td className="px-3 py-1.5">{p.nextAttemptAt ? formatDateTime(p.nextAttemptAt, tz) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Run</th>
                    <th className="px-3 py-1.5 text-left font-medium">Trigger</th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    <th className="px-3 py-1.5 text-left font-medium">Started</th>
                    <th className="px-3 py-1.5 text-right font-medium">Records</th>
                    <th className="px-3 py-1.5 text-left font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {status.recentRuns.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5">{r.syncType}</td>
                      <td className="px-3 py-1.5">{r.trigger}</td>
                      <td className={`px-3 py-1.5 ${r.status === "failed" ? "font-medium text-status-critical" : ""}`}>{r.status}</td>
                      <td className="px-3 py-1.5">{formatDateTime(r.startedAt, tz)}</td>
                      <td className="px-3 py-1.5 text-right tabular">{r.recordsProcessed.toLocaleString()}</td>
                      <td className="max-w-md truncate px-3 py-1.5" title={r.errorMessage ?? ""}>{r.errorMessage ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Monthly sales targets" description="Used for target progress and pipeline coverage. Leave blank for no target.">
            <TargetsForm month={month} salespeople={sps.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))} targets={Object.fromEntries(targets.map((t) => [t.salespersonId, t.targetCents]))} />
          </Section>
          <Section title="Action thresholds" description="Rules for the priority queue">
            <ThresholdsForm t={thresholds} />
          </Section>
        </div>

        <Section title="Users" description="Link each app user to their PB salesperson. Unlinked salespeople see nothing. Admins come from ADMIN_EMAILS or this table.">
          <div className="space-y-2">
            {appUsers.map((u) => (
              <UserLinkRow key={u.id} user={{ id: u.id, name: u.name, email: u.email, role: u.role, salespersonId: u.salespersonId }} salespeople={sps.map((s) => ({ id: s.id, name: s.name, active: s.active }))} isSelf={u.id === viewer.userId} />
            ))}
          </div>
        </Section>

        <Section title="Activity assignment mapping" description="PB assigns activities to users (GET /users), not sales reps. PB does not document how the two relate, so they are matched by identical name; correct any mismatch here.">
          <div className="space-y-2">
            {sps.filter((s) => s.active).map((s) => (
              <PbUserMappingRow key={s.id} salesperson={{ id: s.id, name: s.name, pbUserId: s.pbUserId }} pbUsers={pbUsers} />
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
