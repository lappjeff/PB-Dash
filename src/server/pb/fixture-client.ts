import type { ListCustomersParams, ListOpportunitiesParams, Page, PbClient } from "./client";
import type { PbActivity, PbCustomer, PbLookupEntry, PbOpportunity, PbSalesStage } from "./types";

export type FixtureDataset = {
  salesReps: PbLookupEntry[];
  users: PbLookupEntry[];
  salesStages: PbSalesStage[];
  jobTypes: PbLookupEntry[];
  leadSources: PbLookupEntry[];
  lostReasons: PbLookupEntry[];
  customers: PbCustomer[];
  opportunities: PbOpportunity[];
  activities: Record<string, PbActivity[]>;
};

/**
 * In-memory PB API that serves a dataset shaped exactly like the documented
 * responses. Used for demo mode and automated tests — never talks to the network.
 * Cursors are opaque strings, rows come back unordered-but-stable, as documented.
 */
export class FixturePbClient implements PbClient {
  calls: string[] = [];
  /** Test hook: make the next N calls fail with this error. */
  failNext: { count: number; error: Error } | null = null;

  constructor(public data: FixtureDataset) {}

  private hit(name: string) {
    this.calls.push(name);
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count--;
      throw this.failNext.error;
    }
  }

  async listSalesReps() {
    this.hit("sales-reps");
    return structuredClone(this.data.salesReps);
  }
  async listSalesStages() {
    this.hit("sales-stages");
    return structuredClone(this.data.salesStages);
  }
  async listJobTypes() {
    this.hit("job-types");
    return structuredClone(this.data.jobTypes);
  }
  async listLeadSources() {
    this.hit("lead-sources");
    return structuredClone(this.data.leadSources);
  }
  async listLostReasons() {
    this.hit("lost-reasons");
    return structuredClone(this.data.lostReasons);
  }
  async listUsers() {
    this.hit("users");
    return structuredClone(this.data.users);
  }

  async listCustomers(p: ListCustomersParams): Promise<Page<PbCustomer>> {
    this.hit("customers");
    const rows = this.data.customers.filter((c) => p.includeArchived || !c.archived);
    return paginate(rows, p.cursor, p.limit);
  }

  async getCustomer(id: string) {
    this.hit(`customer:${id}`);
    const c = this.data.customers.find((x) => x.id === id);
    return c ? structuredClone(c) : null;
  }

  async listOpportunities(p: ListOpportunitiesParams): Promise<Page<PbOpportunity>> {
    this.hit(`opportunities${p.status ? `:${p.status}` : ""}`);
    const rows = this.data.opportunities.filter(
      (o) => (p.includeArchived || !o.archived) && (!p.status || o.status === p.status),
    );
    return paginate(rows, p.cursor, p.limit);
  }

  async getOpportunity(id: string) {
    this.hit(`opportunity:${id}`);
    const o = this.data.opportunities.find((x) => x.id === id);
    return o ? structuredClone(o) : null;
  }

  async listActivities(opportunityId: string) {
    this.hit(`activities:${opportunityId}`);
    return structuredClone(this.data.activities[opportunityId] ?? []);
  }
}

function paginate<T>(rows: T[], cursor: string | null | undefined, limit = 100): Page<T> {
  const size = Math.min(500, Math.max(1, limit));
  const offset = cursor ? Number(Buffer.from(cursor, "base64url").toString("utf8").replace("o:", "")) : 0;
  const slice = rows.slice(offset, offset + size);
  const next = offset + size < rows.length ? Buffer.from(`o:${offset + size}`).toString("base64url") : null;
  return { data: structuredClone(slice), nextCursor: next };
}
