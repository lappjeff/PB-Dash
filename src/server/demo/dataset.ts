/**
 * Generates a deterministic DEMO dataset in the documented PB response shapes.
 * All names, customers and amounts are fictional.
 */
import { addDays, format } from "date-fns";
import type { FixtureDataset } from "@/server/pb/fixture-client";
import type { PbActivity, PbCustomer, PbOpportunity } from "@/server/pb/types";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(r: () => number) {
  const h = () => Math.floor(r() * 16).toString(16);
  const s = (n: number) => Array.from({ length: n }, h).join("");
  return `${s(8)}-${s(4)}-4${s(3)}-${"89ab"[Math.floor(r() * 4)]}${s(3)}-${s(12)}`;
}

const REP_NAMES = [
  "Avery Collins", "Jordan Reyes", "Morgan Patel", "Riley Okafor", "Casey Lindqvist",
  "Taylor Brennan", "Quinn Nakamura", "Drew Castellano", "Sam Whitaker", "Jamie Duarte",
];
const STAGES: { name: string; status: "pending" | "won" | "lost" }[] = [
  { name: "New Lead", status: "pending" },
  { name: "Contacted", status: "pending" },
  { name: "Site Visit Scheduled", status: "pending" },
  { name: "Estimate Sent", status: "pending" },
  { name: "Negotiation", status: "pending" },
  { name: "Contract Signed", status: "won" },
  { name: "Lost", status: "lost" },
];
const JOB_TYPES: { name: string; min: number; max: number }[] = [
  { name: "Kitchen Remodel", min: 28000, max: 120000 },
  { name: "Bathroom Remodel", min: 12000, max: 55000 },
  { name: "Home Addition", min: 60000, max: 260000 },
  { name: "Roofing", min: 9000, max: 38000 },
  { name: "Siding", min: 11000, max: 42000 },
  { name: "Windows & Doors", min: 6000, max: 30000 },
  { name: "Basement Finish", min: 25000, max: 90000 },
  { name: "Deck & Patio", min: 8000, max: 45000 },
];
const LEAD_SOURCES = ["Website", "Referral", "Google Ads", "Home Show", "Repeat Customer", "Facebook", "Yard Sign"];
const LOST_REASONS = ["Price", "Timing", "Went with competitor", "No response", "Scope changed"];
const FIRST = ["Alex", "Blair", "Cameron", "Dana", "Elliot", "Frankie", "Gray", "Harper", "Indy", "Jesse", "Kai", "Logan", "Marlow", "Noel", "Oakley", "Parker", "Reese", "Sage", "Tatum", "Val"];
const LAST = ["Abbott", "Bishop", "Carver", "Dalton", "Ellison", "Fairbanks", "Gallagher", "Hollis", "Ingram", "Jansen", "Kessler", "Lowell", "Mercer", "Norwood", "Osborne", "Pruitt", "Quill", "Rowan", "Sutton", "Thorne", "Underhill", "Voss", "Winslow", "Yates"];
const ACTIVITY_TITLES: [string, string][] = [
  ["phone", "Call to follow up on estimate"],
  ["meeting", "Site visit"],
  ["email", "Send revised proposal"],
  ["text", "Confirm appointment time"],
  ["task", "Prepare material selections"],
  ["phone", "Check in on financing decision"],
];

export function generateDemoDataset(now: Date = new Date(), seed = 20261104): FixtureDataset {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const ymd = (d: Date) => format(d, "yyyy-MM-dd");

  const salesReps = REP_NAMES.map((name) => ({ id: uuid(r), name }));
  // PB user ids are distinct from sales-rep ids; names match, which the sync auto-maps.
  const users = [...REP_NAMES, "Office Manager"].map((name) => ({ id: uuid(r), name }));
  const salesStages = STAGES.map((s) => ({ id: uuid(r), name: s.name, status: s.status }));
  const jobTypes = JOB_TYPES.map((j) => ({ id: uuid(r), name: j.name }));
  const leadSources = LEAD_SOURCES.map((name) => ({ id: uuid(r), name }));
  const lostReasons = LOST_REASONS.map((name) => ({ id: uuid(r), name }));
  // A former rep, no longer in /sales-reps, still owns old opportunities.
  const formerRep = { id: uuid(r), name: "Pat Holloway" };

  const repSkill = salesReps.map(() => 0.35 + r() * 0.3);
  const repVolume = salesReps.map(() => 0.6 + r() * 0.8);

  const customers: PbCustomer[] = [];
  const opportunities: PbOpportunity[] = [];
  const activities: Record<string, PbActivity[]> = {};
  const totalDays = 3 * 365;
  let jobNo = 10_000;

  for (let dayOffset = totalDays; dayOffset >= 0; dayOffset--) {
    const day = addDays(now, -dayOffset);
    const month = day.getMonth();
    const seasonal = 1 + 0.45 * Math.sin(((month - 2) / 12) * 2 * Math.PI); // spring/summer peak
    const expected = 2.2 * seasonal;
    let n = Math.floor(expected);
    if (r() < expected - n) n++;

    for (let k = 0; k < n; k++) {
      const repWeights = repVolume.map((v) => v);
      let pickR = r() * repWeights.reduce((a, b) => a + b, 0);
      let repIdx = 0;
      while ((pickR -= repWeights[repIdx]) > 0) repIdx++;
      const useFormer = dayOffset > 500 && repIdx === 9 && r() < 0.6;
      const rep = useFormer ? formerRep : salesReps[repIdx];

      const first = pick(FIRST);
      const last = pick(LAST);
      const repeat = customers.length > 50 && r() < 0.12;
      let customer: PbCustomer;
      if (repeat) {
        customer = customers[Math.floor(r() * customers.length)];
      } else {
        customer = {
          id: uuid(r),
          display_name: `${first} ${last}${r() < 0.3 ? ` ${customers.length}` : ""}`,
          first_name: first,
          last_name: last,
          company: null,
          billing_address: { address1: `${100 + Math.floor(r() * 9000)} Demo St`, address2: null, city: "Sampleton", state: "OH", zip: "45000" },
          phones: [{ phone: "555-555-0100", label: "Mobile" }],
          emails: [{ email: "demo@example.invalid", label: "Email 1" }],
          notes: null,
          lead_source: r() < 0.04 ? null : pick(leadSources),
          sales_rep: { id: rep.id, name: rep.name },
          created_date: ymd(day),
          archived: false,
          current_opportunity: null,
          opportunities: [],
        };
        customers.push(customer);
      }

      const jt = Math.floor(r() * JOB_TYPES.length);
      const job = JOB_TYPES[jt];
      const revenue = r() < 0.035 ? null : Math.round((job.min + r() * (job.max - job.min)) / 50) * 50 + (r() < 0.2 ? 0.5 : 0);
      const ageDays = dayOffset;
      const skill = useFormer ? 0.4 : repSkill[repIdx];
      const temperature = r() < 0.15 ? null : pick(["hot", "warm", "cold"]);

      let stageIdx: number;
      let closedAt: string | null = null;
      // Probability the opportunity has closed grows with age.
      const closeProb = Math.min(0.97, ageDays / 75);
      if (r() < closeProb) {
        const won = r() < skill * (temperature === "hot" ? 1.25 : temperature === "cold" ? 0.7 : 1);
        stageIdx = won ? 5 : 6;
        const cycle = Math.min(ageDays, Math.floor(7 + r() * 85));
        const closeDay = addDays(day, cycle);
        closeDay.setUTCHours(13 + Math.floor(r() * 9), Math.floor(r() * 60), 0, 0);
        closedAt = closeDay.toISOString().replace(".000Z", "+00:00");
      } else {
        stageIdx = Math.min(4, Math.floor(r() * 5));
      }
      const stage = salesStages[stageIdx];
      const status = STAGES[stageIdx].status;
      const id = uuid(r);
      const description = `${last} ${job.name}`;
      const archived = status !== "pending" && ageDays > 600 && r() < 0.25;

      const opp: PbOpportunity = {
        id,
        number: String(jobNo++),
        customer: { id: customer.id, name: customer.display_name ?? `${first} ${last}` },
        description,
        notes: null,
        site_address: customer.billing_address,
        job_type: jobTypes[jt],
        temperature,
        revenue,
        sales_stage: { id: stage.id, name: stage.name },
        status,
        sales_rep: { id: rep.id, name: rep.name },
        lost_reason: status === "lost" ? (r() < 0.85 ? pick(lostReasons) : null) : null,
        closed_at: closedAt,
        completed_at: status === "won" && ageDays > 120 && r() < 0.8 ? addDays(new Date(closedAt!), 30 + Math.floor(r() * 60)).toISOString().replace(".000Z", "+00:00") : null,
        created_date: ymd(day),
        archived,
      };
      opportunities.push(opp);
      const summary = { id, number: opp.number, description, sales_stage: opp.sales_stage, status };
      customer.opportunities = [...(customer.opportunities ?? []), summary];
      customer.current_opportunity = summary;

      // Activities: open opportunities mostly have some; a few have none (follow-up gap).
      const user = users[useFormer ? 10 : repIdx];
      const list: PbActivity[] = [];
      if (status === "pending") {
        const count = r() < 0.18 ? 0 : 1 + Math.floor(r() * 3);
        for (let a = 0; a < count; a++) {
          const [type, title] = pick(ACTIVITY_TITLES);
          const due = addDays(now, Math.floor(-12 + r() * 26));
          const done = due < now && r() < 0.6;
          list.push({
            id: uuid(r),
            opportunity: { id, number: opp.number },
            title,
            type,
            assigned_user: { id: user.id, name: user.name },
            due_date: ymd(due),
            begin_time: r() < 0.6 ? `${String(8 + Math.floor(r() * 9)).padStart(2, "0")}:${r() < 0.5 ? "00" : "30"}` : null,
            completed_at: done ? addDays(due, 0).toISOString().replace(".000Z", "+00:00") : null,
            note: null,
          });
        }
      }
      activities[id] = list.sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
    }
  }

  return { salesReps, users, salesStages, jobTypes, leadSources, lostReasons, customers, opportunities, activities };
}
