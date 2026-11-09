CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"number" text,
	"type" text,
	"invoice_date" date,
	"due_date" date,
	"total_cents" bigint,
	"void" boolean DEFAULT false NOT NULL,
	"pb_job_id" text,
	"opportunity_id" integer,
	"pb_customer_id" text,
	"customer_id" integer,
	"last_pb_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"pb_id" text NOT NULL,
	"name" text,
	"company" text,
	"last_pb_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_pb_id_unique" UNIQUE("pb_id")
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_opp_idx" ON "invoices" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "invoices_job_idx" ON "invoices" USING btree ("pb_job_id");--> statement-breakpoint
CREATE INDEX "invoices_date_idx" ON "invoices" USING btree ("invoice_date");