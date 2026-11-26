CREATE TABLE "messaging_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_business_id" text,
	"legacy_business_id" text NOT NULL,
	"name" text NOT NULL,
	"vertical" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_businesses_legacy_business_id_unique" UNIQUE("legacy_business_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"product" text,
	"waba_id" text,
	"phone_number_id" text NOT NULL,
	"display_phone" text,
	"display_name" text,
	"token_secret_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"test_passed" boolean DEFAULT false NOT NULL,
	"validation_mode" text,
	"test_message" text,
	"tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_accounts_messaging_business_id_unique" UNIQUE("messaging_business_id"),
	CONSTRAINT "whatsapp_accounts_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_automation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"automation_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"state" text DEFAULT 'start' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_at" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"legacy_customer_id" text,
	"phone_enc" text NOT NULL,
	"phone_hash" text NOT NULL,
	"wa_id" text,
	"profile_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"contact_id" uuid,
	"legacy_contact_id" text,
	"state" text DEFAULT 'start' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"handoff_status" text DEFAULT 'bot' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_incoming_at" timestamp with time zone,
	"last_outgoing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"meta_event_id" text NOT NULL,
	"meta_message_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_message_events_meta_event_id_unique" UNIQUE("meta_event_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"conversation_id" uuid,
	"meta_message_id" text NOT NULL,
	"direction" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"failure_reason" text,
	"provider_timestamp" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_messages_meta_message_id_unique" UNIQUE("meta_message_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_phone_mappings" (
	"phone_number_id" text PRIMARY KEY NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"whatsapp_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"meta_template_id" text,
	"name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"category" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"meta_event_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"failure_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_webhook_events_meta_event_id_unique" UNIQUE("meta_event_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_automation_state" ADD CONSTRAINT "whatsapp_automation_state_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_automation_state" ADD CONSTRAINT "whatsapp_automation_state_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_message_events" ADD CONSTRAINT "whatsapp_message_events_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_mappings" ADD CONSTRAINT "whatsapp_phone_mappings_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_phone_mappings" ADD CONSTRAINT "whatsapp_phone_mappings_whatsapp_account_id_whatsapp_accounts_id_fk" FOREIGN KEY ("whatsapp_account_id") REFERENCES "public"."whatsapp_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_businesses_external_business_id_unique" ON "messaging_businesses" USING btree ("external_business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_automation_state_conversation_key_unique" ON "whatsapp_automation_state" USING btree ("conversation_id","automation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contacts_business_phone_hash_unique" ON "whatsapp_contacts" USING btree ("messaging_business_id","phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversations_business_legacy_contact_unique" ON "whatsapp_conversations" USING btree ("messaging_business_id","legacy_contact_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_business_conversation_idx" ON "whatsapp_messages" USING btree ("messaging_business_id","conversation_id");--> statement-breakpoint
CREATE INDEX "whatsapp_phone_mappings_business_idx" ON "whatsapp_phone_mappings" USING btree ("messaging_business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_templates_business_name_language_unique" ON "whatsapp_templates" USING btree ("messaging_business_id","name","language");