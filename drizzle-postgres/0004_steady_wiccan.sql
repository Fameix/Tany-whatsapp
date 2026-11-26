CREATE TABLE "messaging_subscriptions" (
	"legacy_business_id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"whatsapp_automation" boolean DEFAULT false NOT NULL,
	"campaigns" boolean DEFAULT false NOT NULL,
	"advanced_analytics" boolean DEFAULT false NOT NULL,
	"ai_assistant" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_customer_links" (
	"legacy_business_id" text NOT NULL,
	"whatsapp_phone" text NOT NULL,
	"uid" text NOT NULL,
	"linked" boolean DEFAULT true NOT NULL,
	"pending_intent" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_interaction_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_identities" (
	"phone" text PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"linked" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_link_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"whatsapp_phone" text NOT NULL,
	"legacy_business_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"pending_intent" text,
	"notification_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_customer_links_business_phone_unique" ON "whatsapp_customer_links" USING btree ("legacy_business_id","whatsapp_phone");--> statement-breakpoint
CREATE INDEX "whatsapp_customer_links_phone_idx" ON "whatsapp_customer_links" USING btree ("whatsapp_phone");--> statement-breakpoint
CREATE INDEX "whatsapp_link_sessions_phone_business_used_idx" ON "whatsapp_link_sessions" USING btree ("whatsapp_phone","legacy_business_id","used");