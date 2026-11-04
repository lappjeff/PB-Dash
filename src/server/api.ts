import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./authz";
import { log } from "@/lib/logger";

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Wraps a route handler: consistent JSON errors for auth, validation and unexpected failures. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AuthError) return apiError(e.status, e.code, e.message);
      if (e instanceof ZodError) return apiError(400, "invalid-request", "Invalid request parameters", e.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      log.error("api.unhandled", { error: (e as Error).message });
      return apiError(500, "internal", "Unexpected server error");
    }
  };
}

export function searchParamsObject(url: string | URL) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
export function isAuthorizedCron(req: Request, secret: string | undefined) {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
