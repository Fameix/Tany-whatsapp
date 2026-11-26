CREATE TABLE "messaging_runtime_records" (
	"messaging_business_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"legacy_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_runtime_records" ADD CONSTRAINT "messaging_runtime_records_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_runtime_records_tenant_key_unique" ON "messaging_runtime_records" USING btree ("messaging_business_id","collection","legacy_id");--> statement-breakpoint
CREATE INDEX "messaging_runtime_records_collection_idx" ON "messaging_runtime_records" USING btree ("messaging_business_id","collection");