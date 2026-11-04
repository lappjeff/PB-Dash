import { env } from "@/env";
import { apiError, isAuthorizedCron } from "@/server/api";

export function cronGuard(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return apiError(503, "not-configured", "CRON_SECRET is not configured");
  if (!isAuthorizedCron(req, secret)) return apiError(401, "unauthorized", "Invalid cron authorization");
  return null;
}
