import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { salespeople, salesTargets, users } from "@/db/schema";
import { FixturePbClient } from "@/server/pb/fixture-client";
import { setDemoPbClient } from "@/server/pb";
import { runFullSync } from "@/server/sync/runs";
import { companyTimezone } from "@/env";
import { generateDemoDataset } from "./dataset";
import { simulateInvoices, simulateStageChanges } from "./simulate";
import { monthBounds, todayLocal } from "@/lib/time";
import { log } from "@/lib/logger";
import fs from "node:fs/promises";
import path from "node:path";
import { createPgliteDb } from "@/db/pglite";
import journal from "../../../drizzle/meta/_journal.json";
import type { FixtureDataset } from "@/server/pb/fixture-client";

const CACHE_DIR = path.join(process.cwd(), ".data");

/**
 * Opens the demo database. The first start of each day seeds it through the real
 * pipeline and caches the result (database dump + fixture state) in .data/, so later
 * restarts load in about a second. Delete .data/ to reseed.
 */
export async function openDemoDb(): Promise<Db> {
  // Keyed by day and schema version, so a new migration never loads an outdated dump.
  const day = `${new Date().toISOString().slice(0, 10)}-${journal.entries.at(-1)?.tag ?? "0"}`;
  const dump = path.join(CACHE_DIR, `demo-${day}.tar.gz`);
  const fixture = path.join(CACHE_DIR, `demo-${day}.json`);
  try {
    const [buf, json] = await Promise.all([fs.readFile(dump), fs.readFile(fixture, "utf8")]);
    const { db } = await createPgliteDb({ loadDataDir: new Blob([buf]) });
    setDemoPbClient(new FixturePbClient(JSON.parse(json) as FixtureDataset));
    log.info("demo.loaded_from_cache", { day });
    return db;
  } catch {
    /* no cache yet */
  }
  const { db, client } = await createPgliteDb();
  await seedDemo(db);
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    for (const f of await fs.readdir(CACHE_DIR)) if (f.startsWith("demo-")) await fs.rm(path.join(CACHE_DIR, f));
    const blob = await client.dumpDataDir("gzip");
    await fs.writeFile(dump, Buffer.from(await blob.arrayBuffer()));
    const { getDemoPbClient } = await import("@/server/pb");
    await fs.writeFile(fixture, JSON.stringify(getDemoPbClient()!.data));
  } catch (e) {
    log.warn("demo.cache_write_failed", { error: (e as Error).message });
  }
  return db;
}

export { DEMO_WEBHOOK_SECRET } from "./constants";

/**
 * Demo bootstrap. Runs the *real* import pipeline against the fixture PB client,
 * then replays simulated webhooks through the real ingest + processing code so
 * stage history exists. Everything produced here is fictional demo data.
 */
export async function seedDemo(db: Db) {
  const started = Date.now();
  const tz = companyTimezone();
  const client = new FixturePbClient(generateDemoDataset());
  setDemoPbClient(client);

  const res = await runFullSync({ db, client, tz, trigger: "demo-seed" });
  if (res.status !== "succeeded") throw new Error(`Demo seed failed: ${res.message}`);

  const reps = await db.select().from(salespeople).where(eq(salespeople.active, true)).orderBy(salespeople.name);
  await db.insert(users).values([
    { name: "Demo Admin", email: "admin@demo.invalid", role: "ADMIN", isDemo: true },
    ...reps.map((r) => ({ name: r.name, role: "SALESPERSON" as const, salespersonId: r.id, isDemo: true })),
  ]);

  // Monthly targets for the last 12 months and the next 2.
  const today = todayLocal(tz);
  const [y, m] = today.split("-").map(Number);
  const rows: (typeof salesTargets.$inferInsert)[] = [];
  for (let i = -12; i <= 2; i++) {
    const d = new Date(y, m - 1 + i, 1);
    const { start, end } = monthBounds(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    reps.forEach((rep, idx) => rows.push({ salespersonId: rep.id, periodStart: start, periodEnd: end, targetCents: (60_000 + idx * 7_500) * 100 }));
  }
  await db.insert(salesTargets).values(rows);

  await simulateStageChanges(db, 90, { spreadDays: 45 });
  await simulateInvoices(db, 25);
  log.info("demo.seeded", { ms: Date.now() - started, processed: res.recordsProcessed });
}
