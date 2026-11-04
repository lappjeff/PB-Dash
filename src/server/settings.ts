import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";

export const thresholdsSchema = z.object({
  /** High-value opportunities with no observed PB change for this many days are flagged. */
  highValueCents: z.number().int().min(0).max(1e12),
  highValueStaleDays: z.number().int().min(1).max(365),
  /** Opportunities in their current stage (verified entry) longer than this are flagged. */
  stageAgingDays: z.number().int().min(1).max(365),
  /** No completed activity recorded for this many days is flagged. */
  noRecentActivityDays: z.number().int().min(1).max(365),
  /** Count archived won/lost opportunities in won/lost metrics. PB lists exclude archived records by default. */
  includeArchivedInClosed: z.boolean(),
});
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const DEFAULT_THRESHOLDS: Thresholds = {
  highValueCents: 50_000_00,
  highValueStaleDays: 14,
  stageAgingDays: 30,
  noRecentActivityDays: 21,
  includeArchivedInClosed: false,
};

export async function getThresholds(db: Db): Promise<Thresholds> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "thresholds"));
  const parsed = thresholdsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_THRESHOLDS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveThresholds(db: Db, t: Thresholds) {
  const value = thresholdsSchema.parse(t);
  await db
    .insert(appSettings)
    .values({ key: "thresholds", value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
