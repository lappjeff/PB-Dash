"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { salespeople, salesTargets, users } from "@/db/schema";
import { requireViewer } from "@/server/auth";
import { requireAdmin } from "@/server/authz";
import { saveThresholds, thresholdsSchema } from "@/server/settings";
import { parseDollarsToCents } from "@/lib/money";
import { monthBounds } from "@/lib/time";

export type ActionResult = { ok: boolean; message: string };

async function admin() {
  const v = await requireViewer();
  requireAdmin(v);
  return getDb();
}

export async function saveThresholdsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = await admin();
  const cents = parseDollarsToCents(String(form.get("highValue") ?? ""));
  const parsed = thresholdsSchema.safeParse({
    highValueCents: cents ?? -1,
    highValueStaleDays: Number(form.get("highValueStaleDays")),
    stageAgingDays: Number(form.get("stageAgingDays")),
    noRecentActivityDays: Number(form.get("noRecentActivityDays")),
    includeArchivedInClosed: form.get("includeArchivedInClosed") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check the values: whole days between 1 and 365, and a dollar amount." };
  await saveThresholds(db, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true, message: "Thresholds saved." };
}

export async function saveTargetsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = await admin();
  const month = String(form.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Pick a month." };
  const { start, end } = monthBounds(`${month}-01`);
  let saved = 0;
  for (const [key, value] of form.entries()) {
    const m = /^target_(\d+)$/.exec(key);
    if (!m) continue;
    const spId = Number(m[1]);
    const raw = String(value).trim();
    if (raw === "") {
      await db.delete(salesTargets).where(and(eq(salesTargets.salespersonId, spId), eq(salesTargets.periodStart, start)));
      continue;
    }
    const cents = parseDollarsToCents(raw);
    if (cents === null) return { ok: false, message: `Invalid amount "${raw}".` };
    await db
      .insert(salesTargets)
      .values({ salespersonId: spId, periodStart: start, periodEnd: end, targetCents: cents })
      .onConflictDoUpdate({ target: [salesTargets.salespersonId, salesTargets.periodStart], set: { targetCents: cents, periodEnd: end, updatedAt: new Date() } });
    saved++;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Saved ${saved} target(s) for ${month}.` };
}

const linkSchema = z.object({
  userId: z.coerce.number().int().positive(),
  salespersonId: z.union([z.literal(""), z.coerce.number().int().positive()]),
  role: z.enum(["ADMIN", "SALESPERSON"]),
});

export async function saveUserLinkAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = await admin();
  const me = await requireViewer();
  const p = linkSchema.safeParse(Object.fromEntries(form.entries()));
  if (!p.success) return { ok: false, message: "Invalid input." };
  const spId = p.data.salespersonId === "" ? null : p.data.salespersonId;
  if (p.data.userId === me.userId && p.data.role !== "ADMIN") return { ok: false, message: "You cannot remove your own admin role." };
  if (spId !== null) {
    const taken = await db.select({ id: users.id }).from(users).where(and(eq(users.salespersonId, spId), ne(users.id, p.data.userId)));
    if (taken.length) return { ok: false, message: "That salesperson is already linked to another user." };
  }
  await db.update(users).set({ salespersonId: spId, role: p.data.role, updatedAt: new Date() }).where(eq(users.id, p.data.userId));
  revalidatePath("/settings");
  return { ok: true, message: "User updated." };
}

export async function savePbUserMappingAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const db = await admin();
  const spId = Number(form.get("salespersonId"));
  const pbUserId = String(form.get("pbUserId") ?? "").trim() || null;
  if (!Number.isInteger(spId)) return { ok: false, message: "Invalid salesperson." };
  if (pbUserId) {
    const taken = await db.select({ id: salespeople.id }).from(salespeople).where(and(eq(salespeople.pbUserId, pbUserId), ne(salespeople.id, spId)));
    if (taken.length) return { ok: false, message: "That PB user is mapped to another salesperson." };
  }
  await db.update(salespeople).set({ pbUserId, updatedAt: new Date() }).where(eq(salespeople.id, spId));
  revalidatePath("/settings");
  return { ok: true, message: "Mapping saved. Activity attribution updates on the next activity sync." };
}
