import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { appMode } from "@/env";
import { env } from "@/env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const g = globalThis as unknown as { __pbDb?: Promise<Db> };

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Returns the application database.
 * live: node-postgres pool against Neon (use the pooled connection string).
 * demo: in-memory PGlite, migrated and seeded through the real sync pipeline
 *       using the fixture PB client.
 */
export function getDb(): Promise<Db> {
  if (!g.__pbDb) {
    g.__pbDb = createDb().catch((err) => {
      g.__pbDb = undefined;
      throw err;
    });
  }
  return g.__pbDb;
}

/** Tests inject their own database. */
export function setDb(db: Db | undefined) {
  g.__pbDb = db ? Promise.resolve(db) : undefined;
}

async function createDb(): Promise<Db> {
  const mode = appMode();
  if (mode === "live") {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: env().DATABASE_URL, max: 5 });
    return drizzle(pool, { schema }) as unknown as Db;
  }
  if (mode === "demo") {
    const { openDemoDb } = await import("@/server/demo/seed");
    return openDemoDb();
  }
  throw new Error(
    "Application is misconfigured: DATABASE_URL is not set in production. Set DATABASE_URL, or DEMO_MODE=true for a demo deployment.",
  );
}
