import { z } from "zod";
import {
  listOf,
  pageOf,
  pbActivity,
  pbCustomer,
  pbLookupEntry,
  pbOpportunity,
  pbSalesStage,
  type PbActivity,
  type PbCustomer,
  type PbLookupEntry,
  type PbOpportunity,
  type PbSalesStage,
  type PbStatus,
} from "./types";
import { log } from "@/lib/logger";

export type Page<T> = { data: T[]; nextCursor: string | null };

export type ListOpportunitiesParams = {
  cursor?: string | null;
  limit?: number;
  status?: PbStatus;
  includeArchived?: boolean;
};
export type ListCustomersParams = { cursor?: string | null; limit?: number; includeArchived?: boolean };

/**
 * Read-only view of the documented PB REST API. The application never writes to PB.
 * Implementations: HttpPbClient (live) and FixturePbClient (demo / tests).
 */
export interface PbClient {
  listSalesReps(): Promise<PbLookupEntry[]>;
  listSalesStages(): Promise<PbSalesStage[]>;
  listJobTypes(): Promise<PbLookupEntry[]>;
  listLeadSources(): Promise<PbLookupEntry[]>;
  listLostReasons(): Promise<PbLookupEntry[]>;
  listUsers(): Promise<PbLookupEntry[]>;
  listCustomers(p: ListCustomersParams): Promise<Page<PbCustomer>>;
  /** Returns null on 404. */
  getCustomer(id: string): Promise<PbCustomer | null>;
  listOpportunities(p: ListOpportunitiesParams): Promise<Page<PbOpportunity>>;
  /** Returns null on 404. */
  getOpportunity(id: string): Promise<PbOpportunity | null>;
  /** Not paged per the docs; ordered by due date and time. */
  listActivities(opportunityId: string): Promise<PbActivity[]>;
}

export class PbApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PbApiError";
  }
}

export class PbNotConfiguredError extends Error {
  constructor() {
    super("Precise Builder API is not configured (PRECISE_BUILDER_BASE_URL / PRECISE_BUILDER_API_KEY).");
    this.name = "PbNotConfiguredError";
  }
}

type FetchLike = typeof fetch;

export type HttpPbClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const PAGE_LIMIT_MAX = 500;

export class HttpPbClient implements PbClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpPbClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  listSalesReps() {
    return this.get("/api/v1/sales-reps", listOf(pbLookupEntry)).then((r) => r.data);
  }
  listSalesStages() {
    return this.get("/api/v1/sales-stages", listOf(pbSalesStage)).then((r) => r.data);
  }
  listJobTypes() {
    return this.get("/api/v1/job-types", listOf(pbLookupEntry)).then((r) => r.data);
  }
  listLeadSources() {
    return this.get("/api/v1/lead-sources", listOf(pbLookupEntry)).then((r) => r.data);
  }
  listLostReasons() {
    return this.get("/api/v1/lost-reasons", listOf(pbLookupEntry)).then((r) => r.data);
  }
  listUsers() {
    return this.get("/api/v1/users", listOf(pbLookupEntry)).then((r) => r.data);
  }

  async listCustomers(p: ListCustomersParams): Promise<Page<PbCustomer>> {
    const r = await this.get("/api/v1/customers", pageOf(pbCustomer), {
      limit: String(clampLimit(p.limit)),
      cursor: p.cursor ?? undefined,
      include_archived: p.includeArchived ? "true" : undefined,
    });
    return { data: r.data, nextCursor: r.next_cursor ?? null };
  }

  getCustomer(id: string) {
    return this.getOrNull(`/api/v1/customers/${encodeURIComponent(id)}`, pbCustomer);
  }

  async listOpportunities(p: ListOpportunitiesParams): Promise<Page<PbOpportunity>> {
    const r = await this.get("/api/v1/opportunities", pageOf(pbOpportunity), {
      limit: String(clampLimit(p.limit)),
      cursor: p.cursor ?? undefined,
      status: p.status,
      include_archived: p.includeArchived ? "true" : undefined,
    });
    return { data: r.data, nextCursor: r.next_cursor ?? null };
  }

  getOpportunity(id: string) {
    return this.getOrNull(`/api/v1/opportunities/${encodeURIComponent(id)}`, pbOpportunity);
  }

  async listActivities(opportunityId: string) {
    const r = await this.get(
      `/api/v1/opportunities/${encodeURIComponent(opportunityId)}/activities`,
      listOf(pbActivity),
    );
    return r.data;
  }

  private async getOrNull<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T> | null> {
    try {
      return await this.get(path, schema);
    } catch (e) {
      if (e instanceof PbApiError && e.status === 404) return null;
      throw e;
    }
  }

  private async get<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    query?: Record<string, string | undefined>,
  ): Promise<z.infer<T>> {
    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
        if (res.ok) {
          const ct = res.headers.get("content-type") ?? "";
          if (!ct.includes("json")) {
            // The docs: an HTML page instead of JSON means the base URL or path is wrong.
            throw new PbApiError(`PB returned non-JSON (${ct || "no content type"}) for ${path}; check PRECISE_BUILDER_BASE_URL`, res.status, null, false);
          }
          const json = await res.json();
          const parsed = schema.safeParse(json);
          if (!parsed.success) {
            throw new PbApiError(`PB response for ${path} did not match the documented schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, res.status, "schema-mismatch", false);
          }
          return parsed.data;
        }
        const err = await toApiError(res, path);
        if (!err.retryable || attempt > this.maxRetries) throw err;
        await this.sleep(retryDelay(attempt, res.headers.get("retry-after")));
      } catch (e) {
        if (e instanceof PbApiError) {
          if (!e.retryable || attempt > this.maxRetries) throw e;
          continue;
        }
        // Network error or timeout.
        if (attempt > this.maxRetries) {
          throw new PbApiError(`PB request failed for ${path}: ${(e as Error).message}`, null, "network", true);
        }
        log.warn("pb.request.retry", { path, attempt, error: (e as Error).message });
        await this.sleep(retryDelay(attempt, null));
      }
    }
  }
}

function clampLimit(limit: number | undefined) {
  return Math.min(PAGE_LIMIT_MAX, Math.max(1, limit ?? PAGE_LIMIT_MAX));
}

function retryDelay(attempt: number, retryAfter: string | null) {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 30_000);
  return Math.min(500 * 2 ** (attempt - 1), 8_000);
}

async function toApiError(res: Response, path: string): Promise<PbApiError> {
  let code: string | null = null;
  let detail = "";
  try {
    const body = (await res.json()) as { errors?: { code?: string; detail?: string }[] };
    code = body.errors?.[0]?.code ?? null;
    detail = body.errors?.[0]?.detail ?? "";
  } catch {
    /* non-JSON error body */
  }
  const retryable = res.status >= 500 || res.status === 429 || res.status === 409;
  const hint =
    res.status === 401 || res.status === 403
      ? " (API key missing, wrong, expired, replaced by a newer key, or lacking scope)"
      : "";
  return new PbApiError(`PB ${res.status} for ${path}${code ? ` [${code}]` : ""}${detail ? `: ${detail}` : ""}${hint}`, res.status, code, retryable);
}
