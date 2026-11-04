/**
 * CLI sync against the configured database and PB account, without serverless time limits.
 *   pnpm sync:full        initial import / consistency pass (resumes a partial run)
 *   pnpm sync:reconcile   reconcile open opportunities
 *   pnpm sync:check       read-only PB connectivity check (lists lookups; writes nothing)
 */
import "dotenv/config";

async function main() {
  const mode = process.argv[2] ?? "full";
  const { getPbClient } = await import("@/server/pb");
  const { getDb } = await import("@/db");
  const { companyTimezone, appMode } = await import("@/env");
  if (appMode() !== "live") throw new Error("DATABASE_URL is not set; the CLI only runs against a real database.");
  const client = getPbClient();

  if (mode === "check") {
    const [reps, stages, types, sources] = await Promise.all([client.listSalesReps(), client.listSalesStages(), client.listJobTypes(), client.listLeadSources()]);
    const page = await client.listOpportunities({ limit: 1 });
    console.log(JSON.stringify({ salesReps: reps.length, salesStages: stages.map((s) => `${s.name} (${s.status ?? "?"})`), jobTypes: types.length, leadSources: sources.length, opportunitiesReadable: page.data.length > 0 }, null, 2));
    return;
  }
  const db = await getDb();
  const tz = companyTimezone();
  const { runFullSync, runReconcile } = await import("@/server/sync/runs");
  const run = mode === "reconcile" ? runReconcile : runFullSync;
  const started = Date.now();
  const r = await run({ db, client, tz, trigger: "cli" });
  console.log(JSON.stringify({ ...r, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  if (r.status === "failed") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
