import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "./schema";
import type { Db } from "./index";

/** Fresh in-memory Postgres (WASM) with all migrations applied. Used for demo mode and tests. */
export async function createPgliteDb(opts: { loadDataDir?: Blob } = {}): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : undefined);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return { db: db as unknown as Db, client };
}
