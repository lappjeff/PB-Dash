import "server-only";
import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { adminEmails, appMode, isClerkConfigured } from "@/env";
import { AuthError, type Viewer } from "./authz";

export const DEMO_USER_COOKIE = "pb_demo_user";

export type AuthMode = "clerk" | "demo" | "none";

/** Demo auth is only possible together with the demo database; live data always requires Clerk. */
export function authMode(): AuthMode {
  if (appMode() === "demo") return isClerkConfigured() ? "clerk" : "demo";
  if (appMode() === "live" && isClerkConfigured()) return "clerk";
  return "none";
}

function toViewer(u: typeof users.$inferSelect): Viewer {
  return { userId: u.id, name: u.name, email: u.email, role: u.role, salespersonId: u.salespersonId, isDemo: u.isDemo };
}

export async function getViewer(): Promise<Viewer | null> {
  const mode = authMode();
  const db = await getDb();

  if (mode === "demo") {
    const jar = await cookies();
    const id = Number(jar.get(DEMO_USER_COOKIE)?.value);
    if (Number.isInteger(id) && id > 0) {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      if (u?.isDemo) return toViewer(u);
    }
    const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).orderBy(asc(users.id)).limit(1);
    return admin ? toViewer(admin) : null;
  }

  if (mode === "clerk") {
    const { auth, currentUser } = await import("@clerk/nextjs/server");
    const { userId } = await auth();
    if (!userId) return null;
    const [existing] = await db.select().from(users).where(eq(users.clerkUserId, userId));
    const shouldBeAdmin = (email: string | null) => !!email && adminEmails().includes(email.toLowerCase());
    if (existing) {
      if (existing.role !== "ADMIN" && shouldBeAdmin(existing.email)) {
        const [u] = await db.update(users).set({ role: "ADMIN", updatedAt: new Date() }).where(eq(users.id, existing.id)).returning();
        return toViewer(u);
      }
      return toViewer(existing);
    }
    // First sign-in: provision. Admins come from ADMIN_EMAILS; everyone else starts as an
    // unlinked salesperson who sees nothing until an admin links a PB salesperson.
    const cu = await currentUser();
    const email = cu?.primaryEmailAddress?.emailAddress ?? cu?.emailAddresses?.[0]?.emailAddress ?? null;
    const name = [cu?.firstName, cu?.lastName].filter(Boolean).join(" ") || email || "New user";
    const [u] = await db
      .insert(users)
      .values({ clerkUserId: userId, email, name, role: shouldBeAdmin(email) ? "ADMIN" : "SALESPERSON" })
      .onConflictDoUpdate({ target: users.clerkUserId, set: { updatedAt: new Date() } })
      .returning();
    return toViewer(u);
  }

  return null;
}

export async function requireViewer(): Promise<Viewer> {
  if (authMode() === "none") {
    throw new AuthError(401, "auth-not-configured", "Authentication is not configured (set the Clerk keys).");
  }
  const v = await getViewer();
  if (!v) throw new AuthError(401, "unauthenticated", "Sign in required");
  return v;
}
