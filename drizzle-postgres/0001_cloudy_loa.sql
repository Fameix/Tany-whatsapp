ALTER TABLE "whatsapp_conversations" ADD COLUMN "vertical" text;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN "last_incoming_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN "pending_reply" text;