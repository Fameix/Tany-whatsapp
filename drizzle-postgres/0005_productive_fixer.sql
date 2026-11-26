CREATE TABLE "messaging_catalog_items" (
	"id" text NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" double precision NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"category" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_catalog_product_mappings" (
	"messaging_business_id" uuid NOT NULL,
	"tany_product_id" text NOT NULL,
	"retailer_product_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"whatsapp_review_status" text,
	"whatsapp_availability" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ALTER COLUMN "phone_number_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_businesses" ADD COLUMN "products" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_businesses" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "setup_type" text DEFAULT 'existing' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "business_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "setup_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "catalog_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "catalog_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "internal_testing_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_accounts" ADD COLUMN "test_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_catalog_items" ADD CONSTRAINT "messaging_catalog_items_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_catalog_product_mappings" ADD CONSTRAINT "whatsapp_catalog_product_mappings_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_catalog_items_business_id_unique" ON "messaging_catalog_items" USING btree ("messaging_business_id","id");--> statement-breakpoint
CREATE INDEX "messaging_catalog_items_business_type_idx" ON "messaging_catalog_items" USING btree ("messaging_business_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_catalog_mapping_product_unique" ON "whatsapp_catalog_product_mappings" USING btree ("messaging_business_id","tany_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_catalog_mapping_retailer_unique" ON "whatsapp_catalog_product_mappings" USING btree ("messaging_business_id","catalog_id","retailer_product_id");