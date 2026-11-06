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
  await run("GET /api/v1/users", () => client.listUsers(), (r) => `${r.length} users${r.some((u) => !u.name) ? ` (${r.filter((u) => !u.name).length} without a name; skipped for rep matching)` : ""}`);
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
  }

  if (!results.some((r) => !r.ok) || process.argv.includes("--audit")) await audit(client, stages?.map((s) => ({ id: s.id, status: s.status ?? null })) ?? []);

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed. Nothing was written to PB or to a database.");
  if (failed) process.exitCode = 1;
}

/**
 * Compares a larger raw sample of every documented read endpoint with the field tables in
 * PB's docs. Prints field names, types and counts only. Feeds PB_DOCS_FEEDBACK.md.
 */
async function audit(client: import("@/server/pb/client").HttpPbClient, stages: { id: string; status: string | null }[]) {
  const { DOC_SPECS, auditRecords, findings, newAudit } = await import("@/server/pb/audit");
  const data = (r: unknown) => ((r as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
  const sections: { title: string; result: ReturnType<typeof newAudit>; nullable?: string[] }[] = [];
  const add = (title: string, spec: (typeof DOC_SPECS)[keyof typeof DOC_SPECS], records: unknown[], nullable?: string[]) => {
    const existing = sections.find((s) => s.title === title);
    const result = existing?.result ?? newAudit();
    auditRecords(result, spec, records);
    if (!existing) sections.push({ title, result, nullable });
  };
  const errors: string[] = [];
  const raw = async (path: string, query?: Record<string, string>) => {
    try {
      return await client.getRaw(path, query);
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`);
      return null;
    }
  };

  for (const p of ["sales-reps", "job-types", "lead-sources", "lost-reasons", "users"]) add(`GET /api/v1/${p}`, DOC_SPECS.lookup, data(await raw(`/api/v1/${p}`)));
  add("GET /api/v1/sales-stages", DOC_SPECS["sales stage"], data(await raw("/api/v1/sales-stages")));

  const customerNullable = ["billing_address", "current_opportunity"];
  const customers = data(await raw("/api/v1/customers", { limit: "200", include_archived: "true" }));
  add("customers (list)", DOC_SPECS.customer, customers, customerNullable);
  if (customers[0]?.id) add("customers (single GET)", DOC_SPECS.customer, [await raw(`/api/v1/customers/${encodeURIComponent(String(customers[0].id))}`)], customerNullable);

  // closed_at is "when it was won or lost", so null is expected on pending ones; lost_reason likewise.
  const oppNullable = ["site_address", "completed_at"];
  const opps: Record<string, unknown>[] = [];
  const statusFilterMismatch: string[] = [];
  for (const status of ["pending", "won", "lost"]) {
    const page = data(await raw("/api/v1/opportunities", { limit: "100", status, include_archived: "true" }));
    const off = page.filter((o) => o.status !== status).length;
    if (off) statusFilterMismatch.push(`status=${status} returned ${off} of ${page.length} with another status`);
    opps.push(...page);
  }
  add("opportunities (list)", DOC_SPECS.opportunity, opps, oppNullable);
  if (opps[0]?.id) add("opportunities (single GET)", DOC_SPECS.opportunity, [await raw(`/api/v1/opportunities/${encodeURIComponent(String(opps[0].id))}`)], oppNullable);

  // Docs: an opportunity's status "follows the stage" (the stage's status in GET /sales-stages).
  const stageStatus = new Map(stages.map((s) => [s.id, s.status]));
  const notFollowing = opps.filter((o) => {
    const sid = (o.sales_stage as { id?: string } | null)?.id;
    return sid && stageStatus.has(sid) && stageStatus.get(sid) !== o.status;
  }).length;
  const pendingWithClosedAt = opps.filter((o) => o.status === "pending" && o.closed_at).length;
  const closedWithoutClosedAt = opps.filter((o) => o.status !== "pending" && !o.closed_at).length;

  let activityCount = 0;
  let oppsChecked = 0;
  for (const o of opps.filter((o) => o.status === "pending").concat(opps.filter((o) => o.status !== "pending"))) {
    if (oppsChecked >= 100 || activityCount >= 60) break;
    oppsChecked++;
    const acts = data(await raw(`/api/v1/opportunities/${encodeURIComponent(String(o.id))}/activities`));
    activityCount += acts.length;
    add("activities", DOC_SPECS.activity, acts, ["completed_at", "begin_time"]);
  }

  console.log("\nDocs audit: live responses compared with the field tables in PB's docs");
  console.log("(field names and counts only; no record contents)\n");
  for (const s of sections) {
    const f = findings(s.result, new Set(s.nullable ?? []));
    const mism = f.filter((x) => x.severity === "mismatch");
    const notes = f.filter((x) => x.severity === "note");
    console.log(`  ${s.title} - ${s.result.records} records${f.length ? "" : ": matches the docs"}`);
    for (const x of mism) console.log(`      MISMATCH  ${x.text}`);
    for (const x of notes) console.log(`      null      ${x.text.replace(/^`([^`]+)` was null in /, "$1: null in ")}`);
  }
  console.log(`  activities sampled from ${oppsChecked} opportunities`);
  console.log("\n  Documented behavior checks:");
  console.log(`      ${notFollowing ? "MISMATCH" : "ok      "}  opportunity status follows its stage's status (${notFollowing} of ${opps.length} don't)`);
  console.log(`      ${statusFilterMismatch.length ? "MISMATCH" : "ok      "}  status filter returns only that status${statusFilterMismatch.length ? `: ${statusFilterMismatch.join("; ")}` : ""}`);
  console.log(`      ${pendingWithClosedAt ? "MISMATCH" : "ok      "}  pending opportunities have no closed_at (${pendingWithClosedAt} do)`);
  console.log(`      ${closedWithoutClosedAt ? "MISMATCH" : "ok      "}  won/lost opportunities have closed_at (${closedWithoutClosedAt} don't)`);
  for (const e of errors) console.log(`      ERROR     ${e}`);
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
