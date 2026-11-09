import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { opportunities, stageTransitions, webhookEvents, activities, invoices, vendors } from "@/db/schema";
import { getOpportunityDetail } from "@/server/metrics/opportunities";
import { signPreciseBody, verifyPreciseSignature } from "@/server/pb/signature";
import { ingestWebhook } from "@/server/webhooks/ingest";
import { processPendingEvents } from "@/server/webhooks/process";
import { getKpis } from "@/server/metrics/sales";
import { parseFilters } from "@/server/metrics/filters";
import { PbApiError } from "@/server/pb/client";
import { importedDb, TZ } from "./support/db";
import { envelope, SECRET, signed, stageEvent } from "./support/webhooks";
import { opportunity, STAGE, activity } from "./support/fixtures";
import type { Db } from "@/db";

async function deliver(db: Db, body: object, secret = SECRET) {
  const { raw, header } = signed(body, secret);
  return ingestWebhook(db, { rawBody: raw, signatureHeader: header, webhookIdHeader: (body as { id: string }).id, secrets: [SECRET], expectedAccount: "t1234abcd" });
}

describe("signature verification (documented algorithm)", () => {
  // Test vector from https://app.precisebuilder.com/docs/webhook-signatures/#test-your-code
  const raw =
    '{"account":"t1234abcd","api_version":"2026-10","created_at":"2026-10-21T14:30:00+00:00","data":{"customer":{"archived":false,"billing_address":{"address1":"123 Main St","address2":null,"city":"Springfield","state":"IL","zip":"62701"},"company":null,"email":"jane@example.com","first_name":"Jane","id":"00000000-0000-0000-0000-000000000000","last_name":"Smith","lead_source":"Website","name":"Jane Smith","phone":"555-555-0100"},"object":{"id":"00000000-0000-0000-0000-000000000000","type":"customer"}},"id":"11111111-2222-3333-4444-555555555555","type":"customer.created"}';
  const header = "t=1792593000,v1=a70c602416c487e5b59cf11abd26bbdc12b192cbc5eb7880271ef97b561a1a59";

  it("accepts the documented test vector", () => {
    expect(verifyPreciseSignature(raw, header, ["whsec_example_secret_do_not_use"], 1792593000)).toEqual({ ok: true });
    expect(signPreciseBody(raw, "whsec_example_secret_do_not_use", 1792593000)).toBe(header);
  });
  it("rejects a wrong secret, a modified body, and a missing header", () => {
    expect(verifyPreciseSignature(raw, header, ["whsec_other"], 1792593000)).toMatchObject({ ok: false, reason: "no-matching-signature" });
    expect(verifyPreciseSignature(raw.replace("Jane", "June"), header, ["whsec_example_secret_do_not_use"], 1792593000).ok).toBe(false);
    expect(verifyPreciseSignature(raw, null, ["whsec_example_secret_do_not_use"]).ok).toBe(false);
    expect(verifyPreciseSignature(raw, "garbage", ["whsec_example_secret_do_not_use"])).toMatchObject({ reason: "malformed-header" });
  });
  it("enforces the 5 minute timestamp tolerance", () => {
    expect(verifyPreciseSignature(raw, header, ["whsec_example_secret_do_not_use"], 1792593000 + 301)).toMatchObject({ reason: "timestamp-out-of-range" });
    expect(verifyPreciseSignature(raw, header, ["whsec_example_secret_do_not_use"], 1792593000 - 299).ok).toBe(true);
  });
  it("accepts any v1 during secret rotation", () => {
    const t = Math.floor(Date.now() / 1000);
    const newSig = signPreciseBody("{}", "whsec_new", t).split("v1=")[1];
    expect(verifyPreciseSignature("{}", `t=${t},v1=deadbeef,v1=${newSig}`, ["whsec_new"]).ok).toBe(true);
  });
});

describe("ingest", () => {
  it("rejects invalid signatures without storing anything", async () => {
    const { db } = await importedDb();
    const body = envelope("customer.updated", "customer", "c1");
    const res = await deliver(db, body, "whsec_wrong");
    expect(res.status).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("rejects malformed envelopes and other accounts", async () => {
    const { db } = await importedDb();
    const raw = JSON.stringify({ hello: "world" });
    const r1 = await ingestWebhook(db, { rawBody: raw, signatureHeader: signPreciseBody(raw, SECRET), webhookIdHeader: null, secrets: [SECRET], expectedAccount: null });
    expect(r1.status).toBe(400);
    const other = { ...envelope("customer.updated", "customer", "c1"), account: "tzzzzzzzz" };
    expect((await deliver(db, other)).status).toBe(400);
  });

  it("deduplicates repeated deliveries of the same event id", async () => {
    const { db, client } = await importedDb();
    const body = envelope("customer.updated", "customer", "c1");
    const a = await deliver(db, body);
    const b = await deliver(db, body);
    expect(a.status === 200 && a.body.duplicate).toBe(false);
    expect(b.status === 200 && b.body.duplicate).toBe(true);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
    const s1 = await processPendingEvents({ db, client, tz: TZ });
    const s2 = await processPendingEvents({ db, client, tz: TZ });
    expect(s1.processed).toBe(1);
    expect(s2.claimed).toBe(0);
  });
});

describe("processing", () => {
  it("opportunity.created fetches the record and updates dashboard metrics (incremental sync)", async () => {
    const { db, client } = await importedDb();
    const f = parseFilters({ from: "2026-02-01", to: "2026-02-28" }, TZ);
    const before = await getKpis(db, f, "all", { includeArchived: false });
    const c1 = client.data.customers[0];
    client.data.opportunities.push(opportunity({ id: "o99", customer: c1, stage: STAGE.newLead, revenue: 4321, created: "2026-02-19" }));
    client.data.activities.o99 = [activity("a99", "o99", "2026-02-25")];
    await deliver(db, envelope("opportunity.created", "opportunity", "o99"));
    const s = await processPendingEvents({ db, client, tz: TZ });
    expect(s.processed).toBe(1);
    const after = await getKpis(db, f, "all", { includeArchived: false });
    expect(after.open.count).toBe(before.open.count + 1);
    expect(after.open.valueCents).toBe(before.open.valueCents + 432_100);
    const [row] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o99"));
    expect(row.activitiesSyncedAt).not.toBeNull();
    expect(await db.select().from(activities).where(eq(activities.pbId, "a99"))).toHaveLength(1);
  });

  it("records stage transitions from webhooks; out-of-order events keep correct history and current state", async () => {
    const { db, client } = await importedDb();
    const opp = client.data.opportunities.find((o) => o.id === "o2")!;
    // PB now says o2 is in Estimate Sent (two moves happened).
    opp.sales_stage = { id: STAGE.estimate.id, name: STAGE.estimate.name };
    const later = stageEvent("o2", { id: "s-mid", name: "Contacted" }, { id: STAGE.estimate.id, name: STAGE.estimate.name }, "2026-02-21T10:00:00+00:00");
    const earlier = stageEvent("o2", { id: STAGE.newLead.id, name: STAGE.newLead.name }, { id: "s-mid", name: "Contacted" }, "2026-02-20T10:00:00+00:00");
    await deliver(db, later); // arrives first
    await processPendingEvents({ db, client, tz: TZ });
    await deliver(db, earlier); // arrives late
    await processPendingEvents({ db, client, tz: TZ });

    const [row] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o2"));
    const t = await db.select().from(stageTransitions).where(eq(stageTransitions.opportunityId, row.id)).orderBy(stageTransitions.transitionedAt);
    expect(t.map((x) => [x.previousStageName, x.newStageName, x.source])).toEqual([
      ["New Lead", "Contacted", "webhook"],
      ["Contacted", "Estimate Sent", "webhook"],
    ]);
    // Current state comes from PB, not the late (older) payload.
    const stages = await db.query.salesStages.findMany();
    expect(stages.find((s) => s.id === row.stageId)!.name).toBe("Estimate Sent");
    // Verified stage entry = time of the latest transition into the current stage.
    expect(row.stageEnteredAt?.toISOString()).toBe("2026-02-21T10:00:00.000Z");
  });

  it("does not overwrite newer data with an older fetch", async () => {
    const { db, client } = await importedDb();
    const [row] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o1"));
    // Simulate a newer sync having landed in the future.
    await db.update(opportunities).set({ lastSyncedAt: new Date(Date.now() + 60_000), valueCents: 123 }).where(eq(opportunities.id, row.id));
    client.data.opportunities.find((o) => o.id === "o1")!.revenue = 1;
    await deliver(db, envelope("job.updated", "job", "o1"));
    await processPendingEvents({ db, client, tz: TZ });
    const [after] = await db.select().from(opportunities).where(eq(opportunities.id, row.id));
    expect(after.valueCents).toBe(123);
    const [ev] = await db.select().from(webhookEvents);
    expect(ev.errorMessage).toBe("newer data already stored");
  });

  it("ignores unknown event types without failing", async () => {
    const { db, client } = await importedDb();
    await deliver(db, envelope("something.new", "thing", "x1"));
    await deliver(db, envelope("other.thing", "thing", "x2"));
    const s = await processPendingEvents({ db, client, tz: TZ });
    expect(s).toMatchObject({ ignored: 2, failed: 0 });
    const rows = await db.select().from(webhookEvents);
    expect(rows.every((r) => r.processingStatus === "ignored")).toBe(true);
  });

  it("failed processing is retried with backoff and then succeeds", async () => {
    const { db, client } = await importedDb();
    await deliver(db, envelope("job.updated", "job", "o1"));
    client.failNext = { count: 1, error: new PbApiError("PB 500", 500, null, true) };
    const s1 = await processPendingEvents({ db, client, tz: TZ });
    expect(s1.failed).toBe(1);
    let [ev] = await db.select().from(webhookEvents);
    expect(ev.processingStatus).toBe("failed");
    expect(ev.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // Not due yet:
    expect((await processPendingEvents({ db, client, tz: TZ })).claimed).toBe(0);
    await db.update(webhookEvents).set({ nextAttemptAt: new Date(Date.now() - 1000) });
    const s3 = await processPendingEvents({ db, client, tz: TZ });
    expect(s3.processed).toBe(1);
    [ev] = await db.select().from(webhookEvents);
    expect(ev).toMatchObject({ processingStatus: "processed", attempts: 2 });
  });

  it("activity.completed refreshes that opportunity's activities", async () => {
    const { db, client } = await importedDb();
    client.data.activities.o1[0].completed_at = "2026-02-21T15:00:00+00:00";
    await deliver(db, envelope("activity.completed", "activity", "a1", { activity: { id: "a1" }, job: { id: "o1", name: "Job o1" } }));
    await processPendingEvents({ db, client, tz: TZ });
    const [a] = await db.select().from(activities).where(eq(activities.pbId, "a1"));
    expect(a.status).toBe("completed");
    expect(a.salespersonId).not.toBeNull(); // user auto-mapped to rep by name
  });
});

const invoiceEvent = (id: string, jobId: string | null, total: number, opts: { void?: boolean; createdAt?: string } = {}) =>
  envelope(
    "invoice.created",
    "invoice",
    id,
    {
      invoice: { id, number: "1001", type: "job", date: "2026-02-21", due_date: "2026-03-21", total, void: opts.void ?? false },
      customer: { id: "c1", name: "Jane Smith", email: "jane@example.com", phone: "555-555-0100" },
      job: jobId ? { id: jobId, name: "Smith Kitchen Remodel" } : null,
    },
    opts.createdAt,
  );

describe("invoices and vendors (webhook-only data)", () => {
  it("stores invoice.created linked to its opportunity and shows it on the detail page", async () => {
    const { db, client } = await importedDb();
    await deliver(db, invoiceEvent("i1", "o1", 12500.5));
    await deliver(db, invoiceEvent("i2", "o1", 100, { void: true }));
    expect(await processPendingEvents({ db, client, tz: TZ })).toMatchObject({ processed: 2, failed: 0 });
    const [opp] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o1"));
    const [inv] = await db.select().from(invoices).where(eq(invoices.pbId, "i1"));
    expect(inv).toMatchObject({ totalCents: 1250050, opportunityId: opp.id, invoiceDate: "2026-02-21", void: false });
    const admin = { userId: 1, name: "A", email: null, role: "ADMIN" as const, salespersonId: null, isDemo: false };
    const detail = await getOpportunityDetail(db, opp.id, admin);
    expect(detail!.invoices).toHaveLength(2);
    expect(detail!.invoicedCents).toBe(1250050);
  });

  it("imports an unknown job, keeps job-less invoices, and never lets an older event overwrite", async () => {
    const { db, client } = await importedDb();
    client.data.opportunities.push(opportunity({ id: "o-new", customer: client.data.customers[0], stage: STAGE.won, revenue: 5, created: "2026-02-01", closedAt: "2026-02-10T12:00:00+00:00" }));
    await deliver(db, invoiceEvent("i3", "o-new", 50, { createdAt: "2026-02-22T00:00:00+00:00" }));
    await deliver(db, invoiceEvent("i3", "o-new", 999, { createdAt: "2026-02-21T00:00:00+00:00" }));
    await deliver(db, invoiceEvent("i4", null, 75));
    expect(await processPendingEvents({ db, client, tz: TZ })).toMatchObject({ failed: 0 });
    const [newOpp] = await db.select().from(opportunities).where(eq(opportunities.pbId, "o-new"));
    expect(newOpp).toBeDefined();
    const [i3] = await db.select().from(invoices).where(eq(invoices.pbId, "i3"));
    expect(i3.totalCents).toBe(5000);
    const [i4] = await db.select().from(invoices).where(eq(invoices.pbId, "i4"));
    expect(i4.opportunityId).toBeNull();
  });

  it("stores vendor name and company only, newest event wins", async () => {
    const { db, client } = await importedDb();
    const v = (name: string, at: string) =>
      envelope("vendor.updated", "vendor", "v1", { vendor: { id: "v1", name, company: `${name} Co.`, first_name: null, last_name: null, email: "orders@example.com", phone: "555-555-0101", billing_address: null } }, at);
    await deliver(db, v("Acme Lumber", "2026-02-22T00:00:00+00:00"));
    await deliver(db, v("Old Name", "2026-02-21T00:00:00+00:00"));
    expect(await processPendingEvents({ db, client, tz: TZ })).toMatchObject({ processed: 2, failed: 0 });
    const rows = await db.select().from(vendors);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Acme Lumber", company: "Acme Lumber Co." });
    expect(JSON.stringify(rows[0])).not.toContain("example.com");
  });

  it("fails (and retries) an invoice payload that doesn't match the docs", async () => {
    const { db, client } = await importedDb();
    await deliver(db, envelope("invoice.created", "invoice", "i9", { invoice: { id: "i9", total: "lots" } }));
    expect(await processPendingEvents({ db, client, tz: TZ })).toMatchObject({ failed: 1 });
  });
});
