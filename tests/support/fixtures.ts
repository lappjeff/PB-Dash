/**
 * Small, hand-checkable fixtures in the exact shapes documented at
 * https://app.precisebuilder.com/docs/ (REST v1 + webhook api_version 2026-10).
 */
import type { FixtureDataset } from "@/server/pb/fixture-client";
import type { PbActivity, PbCustomer, PbOpportunity } from "@/server/pb/types";

export const REP_A = { id: "8b0e6f9a-3c2d-4e1f-9a8b-7c6d5e4f3a2b", name: "Kyle Gibson" };
export const REP_B = { id: "9c1f7a0b-4d3e-4f20-8b9c-8d7e6f5a4b3c", name: "Dana Fox" };
export const USER_A = { id: "u-aaaaaaaa-0000-4000-8000-000000000001", name: "Kyle Gibson" };
export const USER_B = { id: "u-bbbbbbbb-0000-4000-8000-000000000002", name: "Dana Fox" };

export const STAGE = {
  newLead: { id: "s-new", name: "New Lead", status: "pending" as const },
  estimate: { id: "s-est", name: "Estimate Sent", status: "pending" as const },
  won: { id: "s-won", name: "Contract Signed", status: "won" as const },
  lost: { id: "s-lost", name: "Lost", status: "lost" as const },
};
export const JOB_REMODEL = { id: "jt-remodel", name: "Remodel" };
export const JOB_ROOF = { id: "jt-roof", name: "Roofing" };
export const SRC_WEB = { id: "acde070d-8c4c-4f0d-9d8a-162843c10334", name: "Website" };
export const SRC_REF = { id: "ls-referral", name: "Referral" };

export function customer(id: string, name: string, leadSource = SRC_WEB, rep = REP_A): PbCustomer {
  const [first, last] = name.split(" ");
  return {
    id,
    display_name: name,
    first_name: first,
    last_name: last ?? null,
    company: null,
    billing_address: { address1: "123 Main St", address2: null, city: "Springfield", state: "IL", zip: "62701" },
    phones: [{ phone: "123-555-0100", label: "Mobile" }],
    emails: [{ email: "james@example.com", label: "Email 1" }],
    notes: null,
    lead_source: leadSource,
    sales_rep: rep,
    created_date: "2026-01-05",
    archived: false,
    current_opportunity: null,
    opportunities: [],
  };
}

type OppInput = {
  id: string;
  customer: PbCustomer;
  stage: { id: string; name: string; status: "pending" | "won" | "lost" };
  revenue: number | null;
  rep?: { id: string; name: string };
  created: string;
  closedAt?: string | null;
  jobType?: { id: string; name: string };
  archived?: boolean;
};

export function opportunity(o: OppInput): PbOpportunity {
  return {
    id: o.id,
    number: o.id.replace(/\D/g, "") || "1001",
    customer: { id: o.customer.id, name: o.customer.display_name ?? null },
    description: `Job ${o.id}`,
    notes: null,
    site_address: null,
    job_type: o.jobType ?? JOB_REMODEL,
    temperature: "warm",
    revenue: o.revenue,
    sales_stage: { id: o.stage.id, name: o.stage.name },
    status: o.stage.status,
    sales_rep: o.rep ?? REP_A,
    lost_reason: null,
    closed_at: o.closedAt ?? null,
    completed_at: null,
    created_date: o.created,
    archived: o.archived ?? false,
  };
}

export function activity(id: string, oppId: string, dueDate: string, opts: { completedAt?: string | null; user?: { id: string; name: string }; time?: string | null } = {}): PbActivity {
  return {
    id,
    opportunity: { id: oppId, number: "1" },
    title: "Call back about estimate",
    type: "phone",
    assigned_user: opts.user ?? USER_A,
    due_date: dueDate,
    begin_time: opts.time ?? null,
    completed_at: opts.completedAt ?? null,
    note: null,
  };
}

/**
 * Hand-checkable dataset (company tz America/New_York):
 *  o1 open  $10,000.50 rep A   o2 open  no value   rep A   o3 open $5,000 rep B (Roofing)
 *  o4 won   $20,000    rep A   created 2026-01-10 closed 2026-02-09 (30 days)
 *  o5 won   $30,000    rep B   created 2026-01-01 closed 2026-03-01T03:00Z = Feb 28 22:00 local (58 days)
 *  o6 lost  $7,500     rep A   closed 2026-02-15
 *  o7 won   no value   rep A   closed 2026-02-20 (created 2026-02-10, 10 days)
 *  o8 won   $99,999    rep A   closed 2026-04-02 (outside February)
 */
export function smallDataset(): FixtureDataset {
  const c1 = customer("c1", "Jane Smith");
  const c2 = customer("c2", "Ann Lee", SRC_REF, REP_B);
  const c3 = customer("c3", "Bo Park");
  const opps = [
    opportunity({ id: "o1", customer: c1, stage: STAGE.estimate, revenue: 10000.5, created: "2026-02-01" }),
    opportunity({ id: "o2", customer: c1, stage: STAGE.newLead, revenue: null, created: "2026-02-03" }),
    opportunity({ id: "o3", customer: c2, stage: STAGE.newLead, revenue: 5000, rep: REP_B, created: "2026-02-04", jobType: JOB_ROOF }),
    opportunity({ id: "o4", customer: c1, stage: STAGE.won, revenue: 20000, created: "2026-01-10", closedAt: "2026-02-09T15:00:00+00:00" }),
    opportunity({ id: "o5", customer: c2, stage: STAGE.won, revenue: 30000, rep: REP_B, created: "2026-01-01", closedAt: "2026-03-01T03:00:00+00:00" }),
    opportunity({ id: "o6", customer: c3, stage: STAGE.lost, revenue: 7500, created: "2026-01-20", closedAt: "2026-02-15T12:00:00+00:00" }),
    opportunity({ id: "o7", customer: c3, stage: STAGE.won, revenue: null, created: "2026-02-10", closedAt: "2026-02-20T12:00:00+00:00" }),
    opportunity({ id: "o8", customer: c3, stage: STAGE.won, revenue: 99999, created: "2026-03-01", closedAt: "2026-04-02T12:00:00+00:00" }),
  ];
  return {
    salesReps: [REP_A, REP_B],
    users: [USER_A, USER_B],
    salesStages: Object.values(STAGE),
    jobTypes: [JOB_REMODEL, JOB_ROOF],
    leadSources: [SRC_WEB, SRC_REF],
    lostReasons: [{ id: "lr-price", name: "Price" }],
    customers: [c1, c2, c3],
    opportunities: opps,
    activities: {
      o1: [activity("a1", "o1", "2026-02-10"), activity("a2", "o1", "2099-01-01")],
      o2: [],
      o3: [activity("a3", "o3", "2026-02-11", { completedAt: "2026-02-11T15:00:00+00:00", user: USER_B })],
    },
  };
}
