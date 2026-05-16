CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;