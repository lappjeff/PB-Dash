import { createPgliteDb } from "@/db/pglite";
import { setDb, schema, type Db } from "@/db";
import { FixturePbClient, type FixtureDataset } from "@/server/pb/fixture-client";
import { setDemoPbClient, setPbClientForTests } from "@/server/pb";
import { runFullSync } from "@/server/sync/runs";
import { smallDataset } from "./fixtures";

export const TZ = "America/New_York";

/**
 * A fresh, migrated database. PGlite (in-process Postgres) by default; set
 * TEST_DATABASE_URL to run the same tests against a real PostgreSQL server
 * (a new database is created per call).
 */
export async function freshDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { db } = await createPgliteDb();
    return db;
  }
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const name = `pbtest_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = `/${name}`;
  const pool = new Pool({ connectionString: u.toString(), max: 4 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as Db;
}

/** Fresh database populated by a real full sync from the fixture PB client. */
export async function importedDb(data: FixtureDataset = smallDataset()) {
  const db = await freshDb();
  const client = new FixturePbClient(data);
  const res = await runFullSync({ db, client, tz: TZ, trigger: "cli", pageLimit: 3 });
  if (res.status !== "succeeded") throw new Error(`import failed: ${res.message}`);
  return { db, client };
}

/** Make route handlers (which call getDb()/getPbClient()) use the test database and client. */
export function useForRoutes(db: Db, client: FixturePbClient) {
  setDb(db);
  setPbClientForTests(client);
  setDemoPbClient(client);
}
