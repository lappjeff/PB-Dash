/**
 * CLI sync against the configured database and PB account, without serverless time limits.
 *   pnpm sync:check       read-only PB connectivity check: calls every endpoint the sync uses,
 *                         validates responses against the documented schemas, writes nothing,
 *                         needs no database
 *   pnpm sync:full        initial import / consistency pass (resumes a partial run)
 *   pnpm sync:reconcile   reconcile open opportunities
 *
 * Reads .env.local, then .env (same as Next.js). Never prints the API key or customer details.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

type Check = { endpoint: string; ok: boolean; detail: string };

async function check() {
  const { HttpPbClient, PbApiError } = await import("@/server/pb/client");
  const base = process.env.PRECISE_BUILDER_BASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.PRECISE_BUILDER_API_KEY?.trim();
  const problems: string[] = [];
  if (!base) problems.push("PRECISE_BUILDER_BASE_URL is not set");
  else if (!/^https:\/\/app\.precisebuilder\.com\/t[a-z0-9]{8}$/i.test(base))
    problems.push(`PRECISE_BUILDER_BASE_URL should look like https://app.precisebuilder.com/t1234abcd (got "${base}")`);
  if (!key) problems.push("PRECISE_BUILDER_API_KEY is not set");
  else if (!key.startsWith("pbk_")) problems.push("PRECISE_BUILDER_API_KEY should start with pbk_");
  if (problems.length) {
    console.error(["Configuration problems:", ...problems.map((p) => `  - ${p}`)].join("\n"));
    process.exitCode = 1;
    return;
  }

  const client = new HttpPbClient({ baseUrl: base!, apiKey: key!, maxRetries: 1 });
  const results: Check[] = [];
  const run = async <T,>(endpoint: string, fn: () => Promise<T>, describe: (r: T) => string): Promise<T | null> => {
    try {
      const r = await fn();
      results.push({ endpoint, ok: true, detail: describe(r) });
      return r;
    } catch (e) {
      const msg = e instanceof PbApiError ? e.message : `${(e as Error).name}: ${(e as Error).message}`;
      results.push({ endpoint, ok: false, detail: msg });
      return null;
    }
  };

  await run("GET /api/v1/sales-reps", () => client.listSalesReps(), (r) => `${r.length} sales reps`);
  const stages = await run("GET /api/v1/sales-stages", () => client.listSalesStages(), (r) => `${r.length} stages`);
  await run("GET /api/v1/job-types", () => client.listJobTypes(), (r) => `${r.length} job types`);
  await run("GET /api/v1/lead-sources", () => client.listLeadSources(), (r) => `${r.length} lead sources`);
  await run("GET /api/v1/lost-reasons", () => client.listLostReasons(), (r) => `${r.length} lost reasons`);
  await run("GET /api/v1/users", () => client.listUsers(), (r) => `${r.length} users`);
  await run("GET /api/v1/customers?limit=5", () => client.listCustomers({ limit: 5 }), (r) => `${r.data.length} rows, more pages: ${r.nextCursor ? "yes" : "no"}`);
  const opps = await run(
    "GET /api/v1/opportunities?limit=5&status=pending",
    () => client.listOpportunities({ limit: 5, status: "pending" }),
    (r) => `${r.data.length} rows, more pages: ${r.nextCursor ? "yes" : "no"}`,
  );
  const sample = opps?.data[0];
  if (sample) {
    await run("GET /api/v1/opportunities/<id>", () => client.getOpportunity(sample.id), (r) => (r ? "readable" : "404"));
    await run("GET /api/v1/opportunities/<id>/activities", () => client.listActivities(sample.id), (r) => `${r.length} activities on one sample opportunity`);
  }

  console.log("\nPrecise Builder connectivity check (read-only)\n");
  for (const r of results) console.log(`${r.ok ? "  OK  " : "  FAIL"}  ${r.endpoint.padEnd(48)} ${r.detail}`);

  if (stages) {
    console.log("\nSales pipeline stages (status decides open / won / lost):");
    for (const s of stages) console.log(`  - ${s.name}: ${s.status ?? "(no status)"}`);
  }
  if (sample) {
    const fields = ["revenue", "closed_at", "created_date", "sales_rep", "sales_stage", "job_type", "temperature", "lost_reason", "archived"] as const;
    const present = fields.map((f) => `${f}=${sample[f] === null || sample[f] === undefined ? "null" : "set"}`).join(", ");
    console.log(`\nSample opportunity fields: ${present}`);
    const extra = Object.keys(sample).filter((k) => !["id", "number", "customer", "description", "notes", "site_address", "completed_at", ...fields].includes(k));
    if (extra.length) console.log(`Undocumented extra fields returned (kept, not used): ${extra.join(", ")}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed. Nothing was written to PB or to a database.");
  if (failed) process.exitCode = 1;
}

async function sync(mode: "full" | "reconcile") {
  const { getPbClient } = await import("@/server/pb");
  const { getDb } = await import("@/db");
  const { companyTimezone, appMode } = await import("@/env");
  if (appMode() !== "live") throw new Error("DATABASE_URL is not set; sync:full and sync:reconcile only run against a real database.");
  const client = getPbClient();
  const db = await getDb();
  const { runFullSync, runReconcile } = await import("@/server/sync/runs");
  const run = mode === "reconcile" ? runReconcile : runFullSync;
  const started = Date.now();
  const r = await run({ db, client, tz: companyTimezone(), trigger: "cli" });
  console.log(JSON.stringify({ ...r, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
  if (r.status === "failed") process.exitCode = 1;
}

const mode = process.argv[2] ?? "full";
(mode === "check" ? check() : sync(mode === "reconcile" ? "reconcile" : "full"))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 100));
