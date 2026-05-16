ALTER TABLE "balances" DROP CONSTRAINT "balances_available_nonnegative";--> statement-breakpoint
ALTER TABLE "balances" ADD COLUMN "credit_limit_micro" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_credit_limit_nonnegative" CHECK ("balances"."credit_limit_micro" >= 0);--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_available_credit_limit" CHECK ("balances"."available_amount_micro" >= -"balances"."credit_limit_micro");