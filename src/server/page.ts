import "server-only";
import { redirect } from "next/navigation";
import { AuthError, type Viewer } from "./authz";
import { authMode, requireViewer } from "./auth";
import { getDb, type Db } from "@/db";
import { getThresholds, type Thresholds } from "./settings";
import { companyTimezone } from "@/env";

export type PageContext = { viewer: Viewer; db: Db; tz: string; thresholds: Thresholds };

/** Resolves the signed-in viewer for a page, redirecting to sign-in when needed. */
export async function pageContext(): Promise<PageContext> {
  try {
    const viewer = await requireViewer();
    const db = await getDb();
    return { viewer, db, tz: companyTimezone(), thresholds: await getThresholds(db) };
  } catch (e) {
    if (e instanceof AuthError && e.code === "unauthenticated" && authMode() === "clerk") redirect("/sign-in");
    throw e;
  }
}
