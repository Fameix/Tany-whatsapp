ALTER TABLE "whatsapp_messages" ADD COLUMN "source_message_id" text;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD COLUMN "delivery_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_business_source_reply_unique" ON "whatsapp_messages" USING btree ("messaging_business_id","source_message_id");