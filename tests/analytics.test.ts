import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { salespeople } from "@/db/schema";
import { parseFilters } from "@/server/metrics/filters";
import { averageCents, buckets, getKpis, getPipelineByStage, getSalespersonScorecard, getTrend, winRate } from "@/server/metrics/sales";
import { salesByJobType, salesByLeadSource, salesCycle, stageAging } from "@/server/metrics/analytics";
import { getPriorityQueue } from "@/server/metrics/priority";
import { DEFAULT_THRESHOLDS } from "@/server/settings";
import { parseDollarsToCents, toCents } from "@/lib/money";
import { activityDueAt, localRangeToUtc } from "@/lib/time";
import { importedDb, TZ } from "./support/db";
import { REP_A } from "./support/fixtures";

const feb = (tz = TZ) => parseFilters({ from: "2026-02-01", to: "2026-02-28" }, tz);
const opts = { includeArchived: false };

let db: Db;
let repA: number;

beforeAll(async () => {
  ({ db } = await importedDb());
  [{ id: repA }] = await db.select({ id: salespeople.id }).from(salespeople).where(eq(salespeople.pbId, REP_A.id));
});

describe("money", () => {
  it("converts PB revenue numbers to integer cents without float drift", () => {
    expect(toCents(10000.5)).toBe(1_000_050);
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004
    expect(toCents(1.005)).toBe(101);
    expect(toCents(12500)).toBe(1_250_000);
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
    expect(parseDollarsToCents("12,500.5")).toBe(1_250_050);
    expect(parseDollarsToCents("abc")).toBeNull();
  });
  it("averages in integer cents", () => {
    expect(averageCents(5_000_000, 2)).toBe(2_500_000);
    expect(averageCents(100, 3)).toBe(33);
    expect(averageCents(200, 3)).toBe(67);
    expect(averageCents(0, 0)).toBeNull();
  });
  it("win rate excludes open and handles zero", () => {
    expect(winRate(3, 1)).toBe(0.75);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("KPIs", () => {
  it("open pipeline sums current open opportunities and reports missing values", async () => {
    const k = await getKpis(db, feb(), "all", opts);
    expect(k.open).toEqual({ count: 3, valueCents: 1_500_050, missingValue: 1 });
  });

  it("won and lost use closing date in the period; missing values are excluded, not zero", async () => {
    const k = await getKpis(db, feb(), "all", opts);
    expect(k.won).toEqual({ count: 3, valueCents: 5_000_000, missingValue: 1 });
    expect(k.lost).toEqual({ count: 1, valueCents: 750_000, missingValue: 0 });
    expect(k.winRate).toBe(0.75);
    expect(k.avgWonCents).toBe(2_500_000); // $50,000 / 2 valued deals, not / 3
  });

  it("date filtering excludes deals closed outside the range", async () => {
    const k = await getKpis(db, parseFilters({ from: "2026-04-01", to: "2026-04-30" }, TZ), "all", opts);
    expect(k.won.count).toBe(1);
    expect(k.won.valueCents).toBe(9_999_900);
    expect(k.lost.count).toBe(0);
  });

  it("salesperson scope restricts every aggregate", async () => {
    const k = await getKpis(db, feb(), [repA], opts);
    expect(k.won).toEqual({ count: 2, valueCents: 2_000_000, missingValue: 1 });
    expect(k.lost.count).toBe(1);
    expect(k.winRate).toBeCloseTo(2 / 3);
    expect(k.open.count).toBe(2);
    expect(k.open.valueCents).toBe(1_000_050);
  });

  it("median sales cycle uses close date (company tz) minus created date", async () => {
    const k = await getKpis(db, feb(), "all", opts);
    expect(k.medianCycleDays).toBe(30); // 10, 30, 58
    const c = await salesCycle(db, feb(), "all", false);
    expect(c).toMatchObject({ n: 3, median: 30 });
  });

  it("timezone boundary: 2026-03-01T03:00Z is still February in New York but March in UTC", async () => {
    expect((await getKpis(db, feb("America/New_York"), "all", opts)).won.count).toBe(3);
    expect((await getKpis(db, feb("UTC"), "all", opts)).won.count).toBe(2);
    const { start, end } = localRangeToUtc("2026-02-01", "2026-02-28", "America/New_York");
    expect(start.toISOString()).toBe("2026-02-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });

  it("dimension filters (job type, stage, lead source)", async () => {
    const options = await db.query.jobTypes.findMany();
    const roof = options.find((j) => j.name === "Roofing")!;
    const f = { ...feb(), jobTypeIds: [roof.id] };
    expect((await getKpis(db, f, "all", opts)).open).toMatchObject({ count: 1, valueCents: 500_000 });
    const src = (await db.query.leadSources.findMany()).find((l) => l.name === "Referral")!;
    const k = await getKpis(db, { ...feb(), leadSourceIds: [src.id] }, "all", opts);
    expect(k.won.count).toBe(1); // o5 via customer c2
  });
});

describe("charts and tables", () => {
  it("pipeline by stage in pipeline order", async () => {
    const p = await getPipelineByStage(db, feb(), "all");
    expect(p.map((s) => [s.stageName, s.count, s.valueCents])).toEqual([
      ["New Lead", 2, 500_000],
      ["Estimate Sent", 1, 1_000_050],
    ]);
  });

  it("trend fills empty periods and buckets by local month", async () => {
    const t = await getTrend(db, parseFilters({ from: "2026-01-01", to: "2026-04-30" }, TZ), "all", opts);
    expect(t.map((p) => [p.bucket, p.won.count, p.lost.count])).toEqual([
      ["2026-01-01", 0, 0],
      ["2026-02-01", 3, 1],
      ["2026-03-01", 0, 0],
      ["2026-04-01", 1, 0],
    ]);
  });

  it("week buckets start on Monday like date_trunc", () => {
    expect(buckets("2026-02-04", "2026-02-17", "week")).toEqual(["2026-02-02", "2026-02-09", "2026-02-16"]);
    expect(buckets("2026-02-15", "2026-07-01", "quarter")).toEqual(["2026-01-01", "2026-04-01", "2026-07-01"]);
  });

  it("scorecard per salesperson", async () => {
    const rows = await getSalespersonScorecard(db, feb(), "all", opts);
    const a = rows.find((r) => r.name === "Kyle Gibson")!;
    expect(a.won.valueCents).toBe(2_000_000);
    expect(a.lost.count).toBe(1);
    expect(a.overdueActivities).toBe(1); // a1 due 2026-02-10, still open
  });

  it("breakdowns by job type and lead source", async () => {
    const jt = await salesByJobType(db, feb(), "all", false);
    expect(jt.find((r) => r.name === "Remodel")).toMatchObject({ wonCount: 3, wonCents: 5_000_000 });
    const ls = await salesByLeadSource(db, feb(), "all", false);
    expect(ls.find((r) => r.name === "Website")).toMatchObject({ wonCount: 2, lostCount: 1 });
  });

  it("stage aging is Unknown without verified stage entries (creation date never substituted)", async () => {
    const a = await stageAging(db, feb(), "all");
    const total = a.stages.reduce((s, st) => s + a.cell[st]["Unknown"].count, 0);
    expect(total).toBe(3);
  });
});

describe("priority queue", () => {
  it("separates overdue activity, missing follow-up, and does not claim no contact", async () => {
    const q = await getPriorityQueue(db, "all", DEFAULT_THRESHOLDS, new Date("2026-02-20T12:00:00Z"));
    const byName = Object.fromEntries(q.map((i) => [i.name, i.reasons.map((r) => r.code)]));
    expect(byName["Job o1"]).toContain("overdue_activity");
    expect(byName["Job o2"]).toContain("no_open_activity");
    for (const item of q) for (const r of item.reasons) expect(r.label.toLowerCase()).not.toContain("not contacted");
  });

  it("activity due time is interpreted in company time zone", () => {
    expect(activityDueAt("2026-02-10", "09:30", TZ)!.toISOString()).toBe("2026-02-10T14:30:00.000Z");
    expect(activityDueAt("2026-02-10", null, TZ)!.toISOString()).toBe("2026-02-11T05:00:00.000Z");
  });
});
