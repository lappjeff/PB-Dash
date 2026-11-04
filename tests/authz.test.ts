import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { opportunities, salespeople } from "@/db/schema";
import { AuthError, resolveScope, type Viewer } from "@/server/authz";
import { getOpportunityDetail, listOpportunities, listParamsSchema } from "@/server/metrics/opportunities";
import { resetEnvCache } from "@/env";
import { importedDb, TZ, useForRoutes } from "./support/db";
import { REP_A, REP_B } from "./support/fixtures";
import type { Db } from "@/db";

const auth = vi.hoisted(() => ({ viewer: null as Viewer | null }));
vi.mock("@/server/auth", () => ({
  authMode: () => "clerk",
  DEMO_USER_COOKIE: "x",
  getViewer: async () => auth.viewer,
  requireViewer: async () => {
    const { AuthError } = await import("@/server/authz");
    if (!auth.viewer) throw new AuthError(401, "unauthenticated", "Sign in required");
    return auth.viewer;
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));

let db: Db;
let repA: number;
let repB: number;
const admin = (): Viewer => ({ userId: 1, name: "Admin", email: null, role: "ADMIN", salespersonId: null, isDemo: false });
const sales = (sp: number | null): Viewer => ({ userId: 2, name: "Rep", email: null, role: "SALESPERSON", salespersonId: sp, isDemo: false });

beforeAll(async () => {
  const r = await importedDb();
  db = r.db;
  useForRoutes(r.db, r.client);
  const reps = await db.select().from(salespeople);
  repA = reps.find((x) => x.pbId === REP_A.id)!.id;
  repB = reps.find((x) => x.pbId === REP_B.id)!.id;
  process.env.CRON_SECRET = "test-cron-secret-0123456789";
  resetEnvCache();
});
afterAll(() => {
  delete process.env.CRON_SECRET;
  resetEnvCache();
});
beforeEach(() => {
  auth.viewer = null;
});

describe("scope rules", () => {
  it("admin sees all or narrows on request", () => {
    expect(resolveScope(admin())).toBe("all");
    expect(resolveScope(admin(), [repB])).toEqual([repB]);
  });
  it("salesperson is limited to themselves and cannot ask for others", () => {
    expect(resolveScope(sales(repA))).toEqual([repA]);
    expect(resolveScope(sales(repA), [repA])).toEqual([repA]);
    expect(() => resolveScope(sales(repA), [repB])).toThrow(AuthError);
  });
  it("unlinked salesperson sees nothing", () => {
    expect(() => resolveScope(sales(null))).toThrow(/not linked/);
  });
});

describe("data access", () => {
  it("salesperson can open their own opportunity but not another's", async () => {
    const [mine] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o1"));
    const [theirs] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o3"));
    expect(await getOpportunityDetail(db, mine.id, sales(repA))).not.toBeNull();
    expect(await getOpportunityDetail(db, theirs.id, sales(repA))).toBeNull();
    expect(await getOpportunityDetail(db, theirs.id, admin())).not.toBeNull();
  });
  it("list queries only return the scoped salesperson's rows", async () => {
    const r = await listOpportunities(db, listParamsSchema.parse({ pageSize: "100" }), [repA], TZ);
    expect(r.rows.every((x) => x.salespersonId === repA)).toBe(true);
    expect(r.total).toBe(6);
  });
});

describe("route handlers", () => {
  it("API requires authentication", async () => {
    const { GET } = await import("@/app/api/opportunities/route");
    const res = await GET(new Request("http://x/api/opportunities"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("salesperson cannot read another salesperson's metrics; admin can", async () => {
    const { GET } = await import("@/app/api/salespeople/[id]/metrics/route");
    auth.viewer = sales(repA);
    const other = await GET(new Request(`http://x/api/salespeople/${repB}/metrics`), { params: Promise.resolve({ id: String(repB) }) });
    expect(other.status).toBe(403);
    const own = await GET(new Request(`http://x/api/salespeople/${repA}/metrics`), { params: Promise.resolve({ id: String(repA) }) });
    expect(own.status).toBe(200);
    auth.viewer = admin();
    const asAdmin = await GET(new Request(`http://x/api/salespeople/${repB}/metrics`), { params: Promise.resolve({ id: String(repB) }) });
    expect(asAdmin.status).toBe(200);
  });

  it("salesperson dashboard API ignores nothing silently: asking for a teammate is 403", async () => {
    const { GET } = await import("@/app/api/dashboard/route");
    auth.viewer = sales(repA);
    expect((await GET(new Request(`http://x/api/dashboard?sp=${repB}`))).status).toBe(403);
    const ok = await GET(new Request(`http://x/api/dashboard?from=2026-02-01&to=2026-02-28`));
    const body = await ok.json();
    expect(body.leaderboard).toHaveLength(1);
    expect(body.kpis.won.valueCents).toBe(2_000_000);
  });

  it("opportunity detail API returns 404 for another salesperson's record", async () => {
    const { GET } = await import("@/app/api/opportunities/[id]/route");
    const [theirs] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o3"));
    auth.viewer = sales(repA);
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: String(theirs.id) }) });
    expect(res.status).toBe(404);
  });

  it("only admins can trigger synchronization", async () => {
    const { POST } = await import("@/app/api/admin/sync/route");
    const req = () => new Request("http://x/api/admin/sync", { method: "POST", body: JSON.stringify({ type: "process-events" }) });
    expect((await POST(req())).status).toBe(401);
    auth.viewer = sales(repA);
    expect((await POST(req())).status).toBe(403);
    auth.viewer = admin();
    expect((await POST(req())).status).toBe(200);
  });

  it("admin-only analytics refuses salespeople", async () => {
    const { GET } = await import("@/app/api/analytics/route");
    auth.viewer = sales(repA);
    expect((await GET(new Request("http://x/api/analytics"))).status).toBe(403);
  });

  it("cron endpoints reject requests without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/process-events/route");
    expect((await GET(new Request("http://x/api/cron/process-events"))).status).toBe(401);
    expect((await GET(new Request("http://x", { headers: { authorization: "Bearer wrong-secret-0123456789" } }))).status).toBe(401);
    const ok = await GET(new Request("http://x", { headers: { authorization: "Bearer test-cron-secret-0123456789" } }));
    expect(ok.status).toBe(200);
  });

  it("CSV export is scoped and neutralises formulas", async () => {
    const { GET } = await import("@/app/api/opportunities/export/route");
    auth.viewer = sales(repB);
    const text = await (await GET(new Request(`http://x/api/opportunities/export`))).text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(3); // header + o3 + o5
    expect(text).not.toContain("Kyle Gibson");
    const { csvCell } = await import("@/lib/csv");
    expect(csvCell("=HYPERLINK()")).toBe("'=HYPERLINK()");
  });
});

describe("webhook route", () => {
  it("verifies, stores and acknowledges; rejects bad signatures", async () => {
    process.env.PRECISE_BUILDER_WEBHOOK_SECRET = "whsec_test_secret";
    resetEnvCache();
    const { POST } = await import("@/app/api/webhooks/precise-builder/route");
    const { envelope, signed } = await import("./support/webhooks");
    const body = envelope("customer.updated", "customer", "c1");
    const { raw, header } = signed(body);
    const ok = await POST(new Request("http://x", { method: "POST", body: raw, headers: { "precise-signature": header, "precise-webhook-id": body.id } }));
    expect(ok.status).toBe(200);
    const bad = await POST(new Request("http://x", { method: "POST", body: raw, headers: { "precise-signature": header.replace(/v1=[0-9a-f]+/, `v1=${"0".repeat(64)}`) } }));
    expect(bad.status).toBe(401);
    delete process.env.PRECISE_BUILDER_WEBHOOK_SECRET;
    resetEnvCache();
  });
});
