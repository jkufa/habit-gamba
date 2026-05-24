CREATE TYPE "public"."recurring_market_series_status" AS ENUM('active', 'ended');
--> statement-breakpoint
CREATE TABLE "recurring_market_series" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_user_id" text NOT NULL,
	"source_market_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"days_of_week_mask" integer NOT NULL,
	"ends_on" text,
	"status" "recurring_market_series_status" DEFAULT 'active' NOT NULL,
	"next_open_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "recurring_series_id" text;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "recurrence_date" text;
--> statement-breakpoint
ALTER TABLE "recurring_market_series" ADD CONSTRAINT "recurring_market_series_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_market_series" ADD CONSTRAINT "recurring_market_series_source_market_id_markets_id_fk" FOREIGN KEY ("source_market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_recurring_series_id_recurring_market_series_id_fk" FOREIGN KEY ("recurring_series_id") REFERENCES "public"."recurring_market_series"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "recurring_market_series" ADD CONSTRAINT "recurring_market_series_days_mask_valid" CHECK ("recurring_market_series"."days_of_week_mask" >= 1 and "recurring_market_series"."days_of_week_mask" <= 127);
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_recurring_series_date_unique" UNIQUE("recurring_series_id","recurrence_date");
--> statement-breakpoint
CREATE INDEX "markets_recurring_series_idx" ON "markets" USING btree ("recurring_series_id");
--> statement-breakpoint
CREATE INDEX "recurring_market_series_creator_idx" ON "recurring_market_series" USING btree ("creator_user_id");
--> statement-breakpoint
CREATE INDEX "recurring_market_series_due_idx" ON "recurring_market_series" USING btree ("status","next_open_at");
