import { z } from "zod";

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const createMarketSchema = z.object({
  description: z.string().trim().min(1).max(4_000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(280),
});

export const openMarketSchema = z.object({
  closesAt: isoDate,
});

export const tradeSchema = z.object({
  amountMicro: z
    .string()
    .regex(/^[1-9]\d*$/u, "amountMicro must be a positive integer string")
    .transform((value) => BigInt(value)),
  outcome: z.enum(["YES", "NO"]),
});

export const resolveMarketSchema = z.object({
  outcome: z.enum(["YES", "NO"]),
});

export const limitSchema = z
  .string()
  .regex(/^[1-9]\d*$/u, "limit must be a positive integer")
  .transform((value) => Math.min(Number(value), 100))
  .optional();
