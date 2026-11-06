import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { opportunities, opportunitySnapshots, stageTransitions, syncRuns, salespeople } from "@/db/schema";
import { FixturePbClient } from "@/server/pb/fixture-client";
import { runFullSync, runReconcile } from "@/server/sync/runs";
import { freshDb, importedDb, TZ } from "./support/db";
import { smallDataset, STAGE } from "./support/fixtures";

describe("full import", () => {
  it("imports all pages, links records and creates initial snapshots but no fabricated history", async () => {
    const { db } = await importedDb();
    expect(await db.select().from(opportunities)).toHaveLength(8);
    expect(await db.select().from(stageTransitions)).toHaveLength(0);
    const snaps = await db.select().from(opportunitySnapshots);
    expect(snaps).toHaveLength(8);
    expect(snaps.every((s) => s.reason === "initial_import")).toBe(true);
    const o = await db.query.opportunities.findFirst({ where: eq(opportunities.pbId, "o1") });
    expect(o).toMatchObject({ valueCents: 1_000_050, status: "pending", lastChangedAt: null, stageEnteredAt: null });
    // Contact details are not kept in raw_data.
    const c = await db.query.customers.findFirst();
    expect(JSON.stringify(c!.rawData)).not.toContain("example.com");
  });

  it("imports when some PB users have no name", async () => {
    const data = smallDataset();
    data.users.push({ id: "user-nameless", name: null });
    const { db } = await importedDb(data);
    expect((await db.select().from(salespeople)).some((s) => s.pbUserId === "user-nameless")).toBe(false);
  });

  it("resumes from a checkpoint when the time budget runs out", async () => {
    const db = await freshDb();
    const client = new FixturePbClient(smallDataset());
    const first = await runFullSync({ db, client, tz: TZ, trigger: "cron", pageLimit: 1, budgetMs: -1 });
    expect(first.status).toBe("partial");
    let last = first;
    for (let i = 0; i < 50 && last.status !== "succeeded"; i++) last = await runFullSync({ db, client, tz: TZ, trigger: "cron", pageLimit: 1, budgetMs: 0 });
    expect(last.status).toBe("succeeded");
    expect(await db.select().from(opportunities)).toHaveLength(8);
  });

  it("refuses to run two syncs of the same type at once", async () => {
    const { db, client } = await importedDb();
    await db.insert(syncRuns).values({ syncType: "full", trigger: "manual" });
    const r = await runFullSync({ db, client, tz: TZ, trigger: "manual" });
    expect(r.status).toBe("skipped");
  });

  it("marks reps missing from /sales-reps as inactive", async () => {
    const data = smallDataset();
    const { db, client } = await importedDb(data);
    client.data.salesReps = [data.salesReps[0]];
    await runFullSync({ db, client, tz: TZ, trigger: "manual" });
    const reps = await db.select().from(salespeople);
    expect(reps.filter((r) => r.active)).toHaveLength(1);
  });
});

describe("reconciliation", () => {
  it("detects missed changes: stage moves, closed deals and deletions", async () => {
    const { db, client } = await importedDb();
    const o1 = client.data.opportunities.find((o) => o.id === "o1")!;
    o1.sales_stage = { id: STAGE.won.id, name: STAGE.won.name };
    o1.status = "won";
    o1.closed_at = "2026-02-22T12:00:00+00:00";
    const o3 = client.data.opportunities.find((o) => o.id === "o3")!;
    o3.sales_stage = { id: STAGE.estimate.id, name: STAGE.estimate.name };
    client.data.opportunities = client.data.opportunities.filter((o) => o.id !== "o2"); // deleted in PB

    const r = await runReconcile({ db, client, tz: TZ, trigger: "cron" });
    expect(r.status).toBe("succeeded");
    const rows = Object.fromEntries((await db.select().from(opportunities)).map((o) => [o.pbId, o]));
    expect(rows.o1.status).toBe("won");
    expect(rows.o1.lastChangedAt).not.toBeNull();
    expect(rows.o2.pbMissingAt).not.toBeNull();
    const t = await db.select().from(stageTransitions);
    // Stage changes found by reconciliation are recorded as approximate, never as verified.
    expect(t.every((x) => x.source === "reconciliation")).toBe(true);
    expect(rows.o3.stageEnteredAt).toBeNull();
  });

  it("reports failures without throwing and keeps existing data", async () => {
    const { db, client } = await importedDb();
    client.failNext = { count: 100, error: new Error("PB unavailable") };
    const r = await runReconcile({ db, client, tz: TZ, trigger: "cron" });
    expect(r.status).toBe("failed");
    expect(r.message).toContain("PB unavailable");
    expect(await db.select().from(opportunities)).toHaveLength(8);
  });
});
