CREATE TABLE "automation_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"product" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_events" (
	"id" text PRIMARY KEY NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"automation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"automation_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"run" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resume_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_states" (
	"id" text PRIMARY KEY NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"automation_id" text,
	"conversation_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "legacy_template_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD COLUMN "definition" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_definitions" ADD CONSTRAINT "automation_definitions_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_states" ADD CONSTRAINT "automation_states_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_definitions_business_status_idx" ON "automation_definitions" USING btree ("messaging_business_id","status");--> statement-breakpoint
CREATE INDEX "automation_events_business_status_idx" ON "automation_events" USING btree ("messaging_business_id","status");--> statement-breakpoint
CREATE INDEX "automation_runs_business_status_idx" ON "automation_runs" USING btree ("messaging_business_id","status");--> statement-breakpoint
CREATE INDEX "automation_states_business_status_idx" ON "automation_states" USING btree ("messaging_business_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_business_legacy_id_unique" ON "whatsapp_templates" USING btree ("messaging_business_id","legacy_template_id");