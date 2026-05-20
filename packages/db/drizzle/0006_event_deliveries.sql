DO $$ BEGIN
	CREATE TYPE "event_delivery_status" AS ENUM('pending', 'processing', 'failed', 'delivered', 'skipped', 'dead');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"consumer_name" text NOT NULL,
	"status" "event_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deliveries_event_consumer_unique" UNIQUE("event_id","consumer_name")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_deliveries_claim_idx" ON "event_deliveries" USING btree ("consumer_name","status","next_attempt_at","locked_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_deliveries_event_idx" ON "event_deliveries" USING btree ("event_id");
