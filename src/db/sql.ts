import { sql, type SQL } from "drizzle-orm";
import type { Db } from "./index";

/** Runs a raw query and returns rows for both node-postgres and PGlite. */
export async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export function inList(column: SQL, ids: (number | string)[]): SQL {
  if (!ids.length) return sql`false`;
  return sql`${column} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
}

export function and_(parts: (SQL | null | undefined | false)[]): SQL {
  const p = parts.filter(Boolean) as SQL[];
  return p.length ? sql.join(p, sql` and `) : sql`true`;
}
