import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Never import this from client components.
 *
 * Application modes:
 *  - "live": DATABASE_URL is set. Clerk must be configured; PB credentials are
 *    needed for synchronization (dashboards still read from the database).
 *  - "demo": no DATABASE_URL, and either not production or DEMO_MODE=true.
 *    Uses an embedded PGlite database seeded from generated fixture data
 *    served by a fake PB client. Every page shows a DEMO DATA banner.
 *  - "misconfigured": production without a database and without DEMO_MODE.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  PRECISE_BUILDER_API_KEY: z.string().min(1).optional(),
  PRECISE_BUILDER_BASE_URL: z
    .string()
    .url()
    .optional()
    .transform((v) => v?.replace(/\/+$/, "")),
  PRECISE_BUILDER_WEBHOOK_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  ADMIN_EMAILS: z.string().optional(),
  COMPANY_TIMEZONE: z.string().default("America/New_York"),
  DEMO_MODE: z.enum(["true", "false"]).optional(),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) out[k] = v === "" ? undefined : v;
  return out;
}

export function env(): Env {
  if (!cached) cached = schema.parse(blankToUndefined(process.env));
  return cached;
}

/** Test hook: re-read process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export type AppMode = "live" | "demo" | "misconfigured";

export function appMode(): AppMode {
  const e = env();
  if (e.DATABASE_URL) return "live";
  if (e.NODE_ENV !== "production" || e.DEMO_MODE === "true") return "demo";
  return "misconfigured";
}

export function isClerkConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && e.CLERK_SECRET_KEY);
}

/** Webhook secrets; comma-separated to support several PB endpoints. */
export function webhookSecrets(): string[] {
  return (env().PRECISE_BUILDER_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adminEmails(): string[] {
  return (env().ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function companyTimezone(): string {
  return env().COMPANY_TIMEZONE;
}

/** The PB account id is the `t…` path segment of the base URL. */
export function pbAccountId(): string | null {
  const base = env().PRECISE_BUILDER_BASE_URL;
  if (!base) return null;
  const m = /\/(t[a-z0-9]{8})$/i.exec(base);
  return m ? m[1] : null;
}
