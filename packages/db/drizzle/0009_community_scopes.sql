DO $$ BEGIN
	CREATE TYPE "public"."role_scope_type" AS ENUM('global', 'community');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communities" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_community_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_provider_community_unique" UNIQUE("provider","provider_community_id"),
	CONSTRAINT "communities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"community_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_member_id" text NOT NULL,
	"display_name_snapshot" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_memberships_community_user_unique" UNIQUE("community_id","user_id"),
	CONSTRAINT "community_memberships_community_provider_member_unique" UNIQUE("community_id","provider_member_id")
);
--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_memberships_user_idx" ON "community_memberships" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "communities" ("id", "provider", "provider_community_id", "slug", "display_name", "metadata")
VALUES ('community_system_default', 'system', 'default', 'habit-gamba', 'Habit Gamba', '{"default":true}'::jsonb)
ON CONFLICT ("provider","provider_community_id") DO UPDATE SET
	"slug" = excluded."slug",
	"display_name" = excluded."display_name",
	"metadata" = excluded."metadata",
	"updated_at" = now();
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN "community_id" text;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "community_id" text;
--> statement-breakpoint
UPDATE "markets" SET "community_id" = 'community_system_default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "balances" SET "community_id" = 'community_system_default' WHERE "community_id" IS NULL;
--> statement-breakpoint
UPDATE "ledger_entries" SET "community_id" = 'community_system_default' WHERE "community_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "balances" DROP CONSTRAINT IF EXISTS "balances_user_currency_unique";
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_currency_community_unique" UNIQUE("user_id","currency","community_id");
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT IF EXISTS "ledger_entries_source_unique";
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_source_community_unique" UNIQUE("source_type","source_id","user_id","community_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "ledger_entries_user_currency_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_user_currency_community_idx" ON "ledger_entries" USING btree ("user_id","currency","community_id");
--> statement-breakpoint
ALTER TABLE "markets" DROP CONSTRAINT IF EXISTS "markets_slug_unique";
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_community_slug_unique" UNIQUE("community_id","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "markets_community_idx" ON "markets" USING btree ("community_id");
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "scope_type" "role_scope_type" DEFAULT 'global' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "scope_id" text DEFAULT '*' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "user_roles_user_role_unique";
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_role_scope_unique" UNIQUE("user_id","role","scope_type","scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_scope_idx" ON "user_roles" USING btree ("scope_type","scope_id");
