import "server-only";
import { appMode, env } from "@/env";
import { HttpPbClient, PbNotConfiguredError, type PbClient } from "./client";
import type { FixturePbClient } from "./fixture-client";

const g = globalThis as unknown as { __pbFixture?: FixturePbClient; __pbHttp?: PbClient };

export function setDemoPbClient(c: FixturePbClient) {
  g.__pbFixture = c;
}
export function getDemoPbClient(): FixturePbClient | undefined {
  return g.__pbFixture;
}

/** Test hook. */
export function setPbClientForTests(c: PbClient | undefined) {
  g.__pbHttp = c;
}

export function isPbConfigured() {
  if (appMode() === "demo") return true;
  const e = env();
  return Boolean(e.PRECISE_BUILDER_API_KEY && e.PRECISE_BUILDER_BASE_URL);
}

export function getPbClient(): PbClient {
  if (g.__pbHttp) return g.__pbHttp;
  if (appMode() === "demo") {
    if (!g.__pbFixture) throw new Error("Demo PB client not initialised");
    return g.__pbFixture;
  }
  const e = env();
  if (!e.PRECISE_BUILDER_API_KEY || !e.PRECISE_BUILDER_BASE_URL) throw new PbNotConfiguredError();
  g.__pbHttp = new HttpPbClient({ baseUrl: e.PRECISE_BUILDER_BASE_URL, apiKey: e.PRECISE_BUILDER_API_KEY });
  return g.__pbHttp;
}
