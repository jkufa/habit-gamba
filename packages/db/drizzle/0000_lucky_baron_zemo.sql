CREATE TYPE "public"."contract_outcome" AS ENUM('YES', 'NO');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('REP');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('seed_grant', 'trade', 'payout', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('draft', 'open', 'closed', 'resolved', 'void');--> statement-breakpoint
CREATE TYPE "public"."resolution_kind" AS ENUM('manual', 'oracle');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "balances" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"currency" "currency" DEFAULT 'REP' NOT NULL,
	"available_amount_micro" bigint DEFAULT 0 NOT NULL,
	"locked_amount_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balances_user_currency_unique" UNIQUE("user_id","currency"),
	CONSTRAINT "balances_available_nonnegative" CHECK ("balances"."available_amount_micro" >= 0),
	CONSTRAINT "balances_locked_nonnegative" CHECK ("balances"."locked_amount_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"outcome" "contract_outcome" NOT NULL,
	"title" text NOT NULL,
	"share_supply_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_market_outcome_unique" UNIQUE("market_id","outcome"),
	CONSTRAINT "contracts_share_supply_nonnegative" CHECK ("contracts"."share_supply_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"currency" "currency" DEFAULT 'REP' NOT NULL,
	"amount_delta_micro" bigint NOT NULL,
	"balance_after_micro" bigint NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_entries_source_unique" UNIQUE("source_type","source_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "market_status" DEFAULT 'draft' NOT NULL,
	"currency" "currency" DEFAULT 'REP' NOT NULL,
	"liquidity_parameter_micro" bigint DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"oracle_adapter" text,
	"oracle_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug"),
	CONSTRAINT "markets_liquidity_nonnegative" CHECK ("markets"."liquidity_parameter_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"quantity_micro" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_user_contract_unique" UNIQUE("user_id","contract_id"),
	CONSTRAINT "positions_quantity_nonnegative" CHECK ("positions"."quantity_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"winning_contract_id" text NOT NULL,
	"resolver_user_id" text,
	"kind" "resolution_kind" DEFAULT 'manual' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oracle_adapter" text,
	"oracle_ref" text,
	"oracle_payload" jsonb,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resolutions_market_unique" UNIQUE("market_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"market_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"idempotency_key" text NOT NULL,
	"shares_delta_micro" bigint NOT NULL,
	"cash_delta_micro" bigint NOT NULL,
	"fee_micro" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "trades_fee_nonnegative" CHECK ("trades"."fee_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"handle" text,
	"display_name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_provider_user_id_unique" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_winning_contract_id_contracts_id_fk" FOREIGN KEY ("winning_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolutions" ADD CONSTRAINT "resolutions_resolver_user_id_users_id_fk" FOREIGN KEY ("resolver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_currency_idx" ON "ledger_entries" USING btree ("user_id","currency");--> statement-breakpoint
CREATE INDEX "markets_creator_idx" ON "markets" USING btree ("creator_user_id");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_user_idx" ON "trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trades_market_idx" ON "trades" USING btree ("market_id");