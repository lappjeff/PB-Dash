import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const cents = (name: string) => bigint(name, { mode: "number" });

export const userRole = pgEnum("user_role", ["ADMIN", "SALESPERSON"]);
/** PB opportunity status. PB documents exactly these three values. */
export const oppStatus = pgEnum("opportunity_status", ["pending", "won", "lost"]);
export const webhookStatus = pgEnum("webhook_status", [
  "pending",
  "processing",
  "processed",
  "failed",
  "dead",
  "ignored",
]);
export const syncStatus = pgEnum("sync_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
  "abandoned",
  "skipped",
]);
export const transitionSource = pgEnum("transition_source", ["webhook", "reconciliation"]);

/* ------------------------------------------------------------------ */
/* Lookup lists (GET /api/v1/sales-reps, sales-stages, job-types, ...) */
/* ------------------------------------------------------------------ */

export const salespeople = pgTable("salespeople", {
  id: serial("id").primaryKey(),
  pbId: text("pb_id").notNull().unique(),
  name: text("name").notNull(),
  /** In the most recent GET /sales-reps list ("current employees with the Sales Rep role"). */
  active: boolean("active").notNull().default(true),
  /**
   * PB *user* id used for activity assignment (GET /users). PB does not document
   * whether user ids equal sales-rep ids, so this is mapped separately.
   */
  pbUserId: text("pb_user_id").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const salesStages = pgTable("sales_stages", {
  id: serial("id").primaryKey(),
  pbId: text("pb_id").notNull().unique(),
  name: text("name").notNull(),
  /** Status an opportunity takes when moved into this stage; null if only seen embedded. */
  status: oppStatus("status"),
  /** Pipeline order from GET /sales-stages; null if not in the current list. */
  position: integer("position"),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

export const jobTypes = pgTable("job_types", {
  id: serial("id").primaryKey(),
  pbId: text("pb_id").notNull().unique(),
  name: text("name").notNull(),
  updatedAt: updatedAt(),
});

export const leadSources = pgTable("lead_sources", {
  id: serial("id").primaryKey(),
  pbId: text("pb_id").notNull().unique(),
  name: text("name").notNull(),
  updatedAt: updatedAt(),
});

export const lostReasons = pgTable("lost_reasons", {
  id: serial("id").primaryKey(),
  pbId: text("pb_id").notNull().unique(),
  name: text("name").notNull(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Application users                                                   */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** Null for demo users. */
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email"),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("SALESPERSON"),
  /** Link to the PB salesperson (spec: pb_salesperson_id). */
  salespersonId: integer("salesperson_id")
    .references(() => salespeople.id, { onDelete: "set null" })
    .unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* CRM records                                                         */
/* ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    pbId: text("pb_id").notNull().unique(),
    name: text("name").notNull(),
    leadSourceId: integer("lead_source_id").references(() => leadSources.id),
    salespersonId: integer("salesperson_id").references(() => salespeople.id),
    archived: boolean("archived").notNull().default(false),
    /** PB `created_date` (a date, no time). */
    pbCreatedDate: date("pb_created_date", { mode: "string" }),
    /**
     * PB exposes no updated timestamp. This is the newest webhook `created_at`
     * observed for the record (spec: pb_updated_at).
     */
    lastPbEventAt: ts("last_pb_event_at"),
    /** When this system observed a change to normalized fields. Null until a change is observed after import. */
    lastChangedAt: ts("last_changed_at"),
    lastSyncedAt: ts("last_synced_at"),
    lastSeenFullSyncId: integer("last_seen_full_sync_id"),
    pbMissingAt: ts("pb_missing_at"),
    rawData: jsonb("raw_data"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("customers_lead_source_idx").on(t.leadSourceId)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    pbId: text("pb_id").notNull().unique(),
    /** PB job number. */
    number: text("number"),
    customerId: integer("customer_id").references(() => customers.id),
    salespersonId: integer("salesperson_id").references(() => salespeople.id),
    /** PB `description`, "the name people see". */
    name: text("name").notNull(),
    stageId: integer("stage_id").references(() => salesStages.id),
    status: oppStatus("status").notNull(),
    /** PB `revenue` ("expected value of the sale") in integer cents; null when PB has no value. */
    valueCents: cents("value_cents"),
    jobTypeId: integer("job_type_id").references(() => jobTypes.id),
    leadTemperature: text("lead_temperature"),
    lostReasonId: integer("lost_reason_id").references(() => lostReasons.id),
    archived: boolean("archived").notNull().default(false),
    pbCreatedDate: date("pb_created_date", { mode: "string" }),
    closedAt: ts("closed_at"),
    completedAt: ts("completed_at"),
    /** Verified entry into the current stage (from an opportunity.stage_updated webhook); null = unknown. */
    stageEnteredAt: ts("stage_entered_at"),
    lastPbEventAt: ts("last_pb_event_at"),
    lastChangedAt: ts("last_changed_at"),
    lastSyncedAt: ts("last_synced_at"),
    activitiesSyncedAt: ts("activities_synced_at"),
    lastSeenFullSyncId: integer("last_seen_full_sync_id"),
    pbMissingAt: ts("pb_missing_at"),
    rawData: jsonb("raw_data"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("opp_salesperson_status_idx").on(t.salespersonId, t.status),
    index("opp_status_closed_idx").on(t.status, t.closedAt),
    index("opp_stage_idx").on(t.stageId),
    index("opp_job_type_idx").on(t.jobTypeId),
    index("opp_customer_idx").on(t.customerId),
    index("opp_created_date_idx").on(t.pbCreatedDate),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    pbId: text("pb_id").notNull().unique(),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    /** Resolved from the PB assigned user via salespeople.pb_user_id; null if unmapped. */
    salespersonId: integer("salesperson_id").references(() => salespeople.id),
    assignedUserPbId: text("assigned_user_pb_id"),
    assignedUserName: text("assigned_user_name"),
    title: text("title").notNull(),
    /** phone | meeting | email | text | task */
    type: text("type").notNull(),
    /** "open" | "completed" (derived from completed_at). */
    status: text("status").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    beginTime: text("begin_time"),
    /** due_date + begin_time in company time zone; end of the due day when no time. */
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    /** From the activity.created webhook envelope; PB REST has no created timestamp. */
    pbCreatedAt: ts("pb_created_at"),
    /** No longer returned by PB for its opportunity. */
    removedAt: ts("removed_at"),
    lastSyncedAt: ts("last_synced_at"),
    rawData: jsonb("raw_data"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activities_opp_idx").on(t.opportunityId),
    index("activities_open_due_idx").on(t.status, t.dueAt),
  ],
);

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export const stageTransitions = pgTable(
  "stage_transitions",
  {
    id: serial("id").primaryKey(),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    previousStageId: integer("previous_stage_id").references(() => salesStages.id),
    newStageId: integer("new_stage_id").references(() => salesStages.id),
    previousStageName: text("previous_stage_name"),
    newStageName: text("new_stage_name"),
    salespersonId: integer("salesperson_id").references(() => salespeople.id),
    /**
     * webhook: envelope created_at of opportunity.stage_updated (exact).
     * reconciliation: time the change was detected (the real time is somewhere
     * between the previous sync and this one).
     */
    transitionedAt: ts("transitioned_at").notNull(),
    source: transitionSource("source").notNull(),
    sourceEventId: integer("source_event_id").references(() => webhookEvents.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("transitions_opp_idx").on(t.opportunityId, t.transitionedAt),
    uniqueIndex("transitions_event_uq").on(t.sourceEventId),
  ],
);

export const opportunitySnapshots = pgTable(
  "opportunity_snapshots",
  {
    id: serial("id").primaryKey(),
    opportunityId: integer("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    salespersonId: integer("salesperson_id").references(() => salespeople.id),
    stageId: integer("stage_id").references(() => salesStages.id),
    status: oppStatus("status").notNull(),
    valueCents: cents("value_cents"),
    /** initial_import | change */
    reason: text("reason").notNull(),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [index("snapshots_opp_idx").on(t.opportunityId, t.capturedAt)],
);

export const salesTargets = pgTable(
  "sales_targets",
  {
    id: serial("id").primaryKey(),
    salespersonId: integer("salesperson_id")
      .notNull()
      .references(() => salespeople.id, { onDelete: "cascade" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    targetCents: cents("target_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("targets_sp_period_uq").on(t.salespersonId, t.periodStart)],
);

/* ------------------------------------------------------------------ */
/* Integration bookkeeping                                             */
/* ------------------------------------------------------------------ */

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    /** Envelope `id` (= Precise-Webhook-Id header). Retries keep it; redeliveries get a new one. */
    providerEventId: text("provider_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    account: text("account"),
    apiVersion: text("api_version"),
    /** Envelope `created_at`: when the event happened in PB. */
    eventCreatedAt: ts("event_created_at"),
    /** Original payload; cleared after the retention window (contains customer contact details). */
    payload: jsonb("payload"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processingStatus: webhookStatus("processing_status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at"),
    lockedAt: ts("locked_at"),
    processedAt: ts("processed_at"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("webhook_status_next_idx").on(t.processingStatus, t.nextAttemptAt),
    index("webhook_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: serial("id").primaryKey(),
    /** full | reconcile | activities */
    syncType: text("sync_type").notNull(),
    /** cron | manual | cli | demo-seed */
    trigger: text("trigger").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    status: syncStatus("status").notNull().default("running"),
    recordsProcessed: integer("records_processed").notNull().default(0),
    errorMessage: text("error_message"),
    details: jsonb("details"),
  },
  (t) => [
    index("sync_runs_type_started_idx").on(t.syncType, t.startedAt),
    // At most one running sync per type.
    uniqueIndex("sync_runs_one_running_uq").on(t.syncType).where(sql`status = 'running'`),
  ],
);

export const syncCheckpoints = pgTable("sync_checkpoints", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
