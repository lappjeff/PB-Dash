CREATE TYPE "public"."opportunity_status" AS ENUM('pending', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'abandoned', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."transition_source" AS ENUM('webhook', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'SALESPERSON');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'dead', 'ignored');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"opportunity_id" integer NOT NULL,
	"salesperson_id" integer,
	"assigned_user_pb_id" text,
	"assigned_user_name" text,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"due_date" date,
	"begin_time" text,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"pb_created_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"lead_source_id" integer,
	"salesperson_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"pb_created_date" date,
	"last_pb_event_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_seen_full_sync_id" integer,
	"pb_missing_at" timestamp with time zone,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "job_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_types_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "lost_reasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_reasons_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"number" text,
	"customer_id" integer,
	"salesperson_id" integer,
	"name" text NOT NULL,
	"stage_id" integer,
	"status" "opportunity_status" NOT NULL,
	"value_cents" bigint,
	"job_type_id" integer,
	"lead_temperature" text,
	"lost_reason_id" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"pb_created_date" date,
	"closed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"stage_entered_at" timestamp with time zone,
	"last_pb_event_at" timestamp with time zone,
	"last_changed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"activities_synced_at" timestamp with time zone,
	"last_seen_full_sync_id" integer,
	"pb_missing_at" timestamp with time zone,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"salesperson_id" integer,
	"stage_id" integer,
	"status" "opportunity_status" NOT NULL,
	"value_cents" bigint,
	"reason" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "opportunity_status",
	"position" integer,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_stages_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"salesperson_id" integer NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"target_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salespeople" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"pb_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salespeople_pb_id_unique" UNIQUE("pb_id"),
	CONSTRAINT "salespeople_pb_user_id_unique" UNIQUE("pb_user_id")
);
--> statement-breakpoint
CREATE TABLE "stage_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" integer NOT NULL,
	"previous_stage_id" integer,
	"new_stage_id" integer,
	"previous_stage_name" text,
	"new_stage_name" text,
	"salesperson_id" integer,
	"transitioned_at" timestamp with time zone NOT NULL,
	"source" "transition_source" NOT NULL,
	"source_event_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoints" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_type" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text,
	"email" text,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'SALESPERSON' NOT NULL,
	"salesperson_id" integer,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "users_salesperson_id_unique" UNIQUE("salesperson_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"account" text,
	"api_version" text,
	"event_created_at" timestamp with time zone,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" "webhook_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "webhook_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lead_source_id_lead_sources_id_fk" FOREIGN KEY ("lead_source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stage_id_sales_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_job_type_id_job_types_id_fk" FOREIGN KEY ("job_type_id") REFERENCES "public"."job_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lost_reason_id_lost_reasons_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."lost_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_snapshots" ADD CONSTRAINT "opportunity_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_snapshots" ADD CONSTRAINT "opportunity_snapshots_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_snapshots" ADD CONSTRAINT "opportunity_snapshots_stage_id_sales_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_previous_stage_id_sales_stages_id_fk" FOREIGN KEY ("previous_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_new_stage_id_sales_stages_id_fk" FOREIGN KEY ("new_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_source_event_id_webhook_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_salesperson_id_salespeople_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."salespeople"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_opp_idx" ON "activities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "activities_open_due_idx" ON "activities" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "customers_lead_source_idx" ON "customers" USING btree ("lead_source_id");--> statement-breakpoint
CREATE INDEX "opp_salesperson_status_idx" ON "opportunities" USING btree ("salesperson_id","status");--> statement-breakpoint
CREATE INDEX "opp_status_closed_idx" ON "opportunities" USING btree ("status","closed_at");--> statement-breakpoint
CREATE INDEX "opp_stage_idx" ON "opportunities" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "opp_job_type_idx" ON "opportunities" USING btree ("job_type_id");--> statement-breakpoint
CREATE INDEX "opp_customer_idx" ON "opportunities" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "opp_created_date_idx" ON "opportunities" USING btree ("pb_created_date");--> statement-breakpoint
CREATE INDEX "snapshots_opp_idx" ON "opportunity_snapshots" USING btree ("opportunity_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_sp_period_uq" ON "sales_targets" USING btree ("salesperson_id","period_start");--> statement-breakpoint
CREATE INDEX "transitions_opp_idx" ON "stage_transitions" USING btree ("opportunity_id","transitioned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transitions_event_uq" ON "stage_transitions" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "sync_runs_type_started_idx" ON "sync_runs" USING btree ("sync_type","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_one_running_uq" ON "sync_runs" USING btree ("sync_type") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "webhook_status_next_idx" ON "webhook_events" USING btree ("processing_status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_entity_idx" ON "webhook_events" USING btree ("entity_type","entity_id");