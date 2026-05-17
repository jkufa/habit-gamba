CREATE TABLE "cancellations" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"reason" text NOT NULL,
	"refund_total_micro" bigint DEFAULT 0 NOT NULL,
	"creator_penalty_micro" bigint DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellations_market_unique" UNIQUE("market_id"),
	CONSTRAINT "cancellations_refund_total_nonnegative" CHECK ("cancellations"."refund_total_micro" >= 0),
	CONSTRAINT "cancellations_creator_penalty_nonnegative" CHECK ("cancellations"."creator_penalty_micro" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cancellations" ADD CONSTRAINT "cancellations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;
