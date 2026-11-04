import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { apiError, handle } from "@/server/api";
import { authMode, DEMO_USER_COOKIE } from "@/server/auth";

/** DEMO ONLY: choose which demo user to view as. Refused whenever real authentication is active. */
export const POST = handle(async (req: Request) => {
  if (authMode() !== "demo") return apiError(404, "not-found", "Not found");
  const { userId } = z.object({ userId: z.number().int().positive() }).parse(await req.json());
  const [u] = await (await getDb()).select().from(users).where(eq(users.id, userId));
  if (!u?.isDemo) return apiError(400, "invalid-user", "Unknown demo user");
  (await cookies()).set(DEMO_USER_COOKIE, String(u.id), { httpOnly: true, sameSite: "lax", path: "/" });
  return NextResponse.json({ ok: true });
});
