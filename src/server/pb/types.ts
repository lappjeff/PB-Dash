import { z } from "zod";

/**
 * Schemas for the Precise Builder REST API (v1) and webhooks (api_version 2026-10),
 * transcribed from https://app.precisebuilder.com/docs/. Every field the docs do not
 * mark as always present is nullable/optional, and unknown fields are kept
 * (the docs say new fields may be added at any time).
 */

const ref = z.object({ id: z.string(), name: z.string().nullable().optional() }).passthrough();
const nullableRef = ref.nullable().optional();

export const pbStatus = z.enum(["pending", "won", "lost"]);
export type PbStatus = z.infer<typeof pbStatus>;

const address = z
  .object({
    address1: z.string().nullable().optional(),
    address2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

/* -------------------------- REST: lookups -------------------------- */

export const pbLookupEntry = z.object({ id: z.string(), name: z.string() }).passthrough();
export const pbSalesStage = pbLookupEntry.extend({ status: pbStatus.nullable().optional() });
export type PbLookupEntry = z.infer<typeof pbLookupEntry>;
export type PbSalesStage = z.infer<typeof pbSalesStage>;

export const listOf = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item) });
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), next_cursor: z.string().nullable().optional() });

/* -------------------------- REST: customers -------------------------- */

const oppSummary = z
  .object({
    id: z.string(),
    number: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    sales_stage: nullableRef,
    status: pbStatus.nullable().optional(),
  })
  .passthrough();

export const pbCustomer = z
  .object({
    id: z.string(),
    display_name: z.string().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    billing_address: address,
    phones: z.array(z.object({ phone: z.string(), label: z.string().nullable().optional() }).passthrough()).nullable().optional(),
    emails: z.array(z.object({ email: z.string(), label: z.string().nullable().optional() }).passthrough()).nullable().optional(),
    notes: z.string().nullable().optional(),
    lead_source: nullableRef,
    sales_rep: nullableRef,
    created_date: z.string().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    current_opportunity: oppSummary.nullable().optional(),
    opportunities: z.array(oppSummary).nullable().optional(),
  })
  .passthrough();
export type PbCustomer = z.infer<typeof pbCustomer>;

/* -------------------------- REST: opportunities -------------------------- */

export const pbOpportunity = z
  .object({
    id: z.string(),
    number: z.string().nullable().optional(),
    customer: nullableRef,
    description: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    site_address: address,
    job_type: nullableRef,
    temperature: z.string().nullable().optional(),
    revenue: z.number().nullable().optional(),
    sales_stage: nullableRef,
    status: pbStatus,
    sales_rep: nullableRef,
    lost_reason: nullableRef,
    closed_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    created_date: z.string().nullable().optional(),
    archived: z.boolean().nullable().optional(),
  })
  .passthrough();
export type PbOpportunity = z.infer<typeof pbOpportunity>;

export const pbActivity = z
  .object({
    id: z.string(),
    opportunity: z.object({ id: z.string(), number: z.string().nullable().optional() }).passthrough().nullable().optional(),
    title: z.string(),
    type: z.string().nullable().optional(),
    assigned_user: nullableRef,
    due_date: z.string().nullable().optional(),
    begin_time: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough();
export type PbActivity = z.infer<typeof pbActivity>;

/* -------------------------- Webhooks -------------------------- */

export const PB_WEBHOOK_EVENTS = [
  "webhook.ping",
  "customer.created",
  "customer.updated",
  "opportunity.created",
  "opportunity.stage_updated",
  "job.updated",
  "invoice.created",
  "vendor.created",
  "vendor.updated",
  "activity.created",
  "activity.completed",
] as const;
export type PbWebhookEventType = (typeof PB_WEBHOOK_EVENTS)[number];

export const pbWebhookEnvelope = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    account: z.string().nullable().optional(),
    api_version: z.string().nullable().optional(),
    created_at: z.string().min(1),
    data: z
      .object({
        object: z.object({ type: z.string(), id: z.string() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export type PbWebhookEnvelope = z.infer<typeof pbWebhookEnvelope>;

/** data of opportunity.stage_updated (only the fields we rely on). */
export const pbStageUpdatedData = z
  .object({
    object: z.object({ type: z.string(), id: z.string() }).passthrough(),
    salesrep: nullableRef,
    stage: nullableRef,
    previous_stage: nullableRef,
  })
  .passthrough();

/** data of activity.created / activity.completed. */
export const pbActivityEventData = z
  .object({
    object: z.object({ type: z.string(), id: z.string() }).passthrough(),
    job: z.object({ id: z.string() }).passthrough().nullable().optional(),
  })
  .passthrough();
