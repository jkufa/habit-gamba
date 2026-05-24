import { REP_SCALE } from "@habit-gamba/db";
import { z } from "zod";

const MIN_TRADE_AMOUNT_MICRO = REP_SCALE / 100n;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const createMarketSchema = z.object({
  description: z.string().trim().min(1).max(4_000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1).max(280),
});

export const openMarketSchema = z.object({
  closesAt: isoDate,
});

export const tradeSchema = z.object({
  amountMicro: z
    .string()
    .regex(/^[1-9]\d*$/u, "amountMicro must be a positive integer string")
    .transform((value) => BigInt(value))
    .refine((value) => value >= MIN_TRADE_AMOUNT_MICRO, {
      message: `amountMicro must be at least ${MIN_TRADE_AMOUNT_MICRO.toString()} (0.01 REP/contracts)`,
    }),
  mode: z.enum(["spend_rep", "target_shares"]).default("spend_rep"),
  outcome: z.enum(["YES", "NO"]),
});

export const resolveMarketSchema = z.object({
  evidence: z.record(z.string(), z.unknown()).optional(),
  outcome: z.enum(["YES", "NO"]),
});

export const limitSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, "limit must be a positive integer")
  .transform((value) => Math.min(Number(value), 100))
  .optional();

export const accountIdentitySchema = z.object({
  admin: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(280),
  handle: z.string().trim().min(1).max(280).nullable().optional(),
  provider: z.string().trim().min(1).max(80),
  providerUserId: z.string().trim().min(1).max(280),
});

export const accountAdjustmentSchema = z.object({
  amountMicro: z
    .string()
    .regex(/^[1-9]\d*$/u, "amountMicro must be a positive integer string")
    .transform((value) => BigInt(value)),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().trim().min(1).max(1_000),
});

export const marketMetadataPatchSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
});

export const marketRefreshQuerySchema = z.object({
  createdAt: z.string().datetime({ offset: true }).optional(),
  id: z.string().min(1).optional(),
});

export const createRecurringMarketSeriesSchema = z.object({
  daysOfWeekMask: z.number().int().min(1).max(127),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "endsOn must use YYYY-MM-DD")
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const endRecurringMarketSeriesSchema = z.object({
  reason: z.string().trim().min(1).max(1_000).nullable().optional(),
});
