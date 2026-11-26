CREATE TABLE "messaging_auth_user_businesses" (
	"user_id" uuid NOT NULL,
	"messaging_business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_auth_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_auth_users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "messaging_phone_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"ip_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_phone_login_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"selected_business_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_auth_user_businesses" ADD CONSTRAINT "messaging_auth_user_businesses_user_id_messaging_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."messaging_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_auth_user_businesses" ADD CONSTRAINT "messaging_auth_user_businesses_messaging_business_id_messaging_businesses_id_fk" FOREIGN KEY ("messaging_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_phone_login_sessions" ADD CONSTRAINT "messaging_phone_login_sessions_user_id_messaging_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."messaging_auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_phone_login_sessions" ADD CONSTRAINT "messaging_phone_login_sessions_selected_business_id_messaging_businesses_id_fk" FOREIGN KEY ("selected_business_id") REFERENCES "public"."messaging_businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_auth_user_businesses_user_tenant_unique" ON "messaging_auth_user_businesses" USING btree ("user_id","messaging_business_id");--> statement-breakpoint
CREATE INDEX "messaging_auth_user_businesses_tenant_idx" ON "messaging_auth_user_businesses" USING btree ("messaging_business_id");--> statement-breakpoint
CREATE INDEX "messaging_phone_login_challenges_phone_created_idx" ON "messaging_phone_login_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "messaging_phone_login_challenges_ip_created_idx" ON "messaging_phone_login_challenges" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "messaging_phone_login_sessions_user_expiry_idx" ON "messaging_phone_login_sessions" USING btree ("user_id","expires_at");