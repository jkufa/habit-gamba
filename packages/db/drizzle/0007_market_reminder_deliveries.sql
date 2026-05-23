CREATE TYPE "public"."market_reminder_delivery_status" AS ENUM('pending', 'processing', 'failed', 'delivered', 'skipped', 'dead');
--> statement-breakpoint
CREATE TABLE "market_reminder_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"slot_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "market_reminder_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"discord_message_id" text,
	"last_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_reminder_deliveries" ADD CONSTRAINT "market_reminder_deliveries_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_reminder_deliveries" ADD CONSTRAINT "market_reminder_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_reminder_deliveries" ADD CONSTRAINT "market_reminder_deliveries_market_recipient_slot_unique" UNIQUE("market_id","recipient_user_id","slot_key");
--> statement-breakpoint
CREATE INDEX "market_reminder_deliveries_claim_idx" ON "market_reminder_deliveries" USING btree ("status","next_attempt_at","locked_until");
--> statement-breakpoint
CREATE INDEX "market_reminder_deliveries_market_idx" ON "market_reminder_deliveries" USING btree ("market_id");
--> statement-breakpoint
CREATE INDEX "market_reminder_deliveries_recipient_idx" ON "market_reminder_deliveries" USING btree ("recipient_user_id");
