import { getDiscordMetadata } from "@habit-gamba/discord";
import { createId, schema, type DbClient } from "@habit-gamba/db";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";

export const MARKET_REMINDER_TIME_ZONE = "America/New_York";
export const MARKET_REMINDER_SLOT_DEFINITIONS = [
  { hour: 18, slotKey: "eod_18_et" },
  { hour: 22, slotKey: "eod_22_et" },
] as const;
export const DEFAULT_MARKET_REMINDER_LOCK_TTL_MS = 60_000;
export const DEFAULT_MARKET_REMINDER_BATCH_LIMIT = 100;
export const MAX_MARKET_REMINDER_BATCH_LIMIT = 1_000;
export const MARKET_REMINDER_RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;
export const MARKET_REMINDER_MAX_ATTEMPTS = MARKET_REMINDER_RETRY_DELAYS_MS.length + 1;

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type ReminderExecutor = DbClient | DbTransaction;
export type MarketReminderDelivery = typeof schema.marketReminderDeliveries.$inferSelect;
export type MarketReminderDeliveryStatus = MarketReminderDelivery["status"];
export type ReminderMarket = Pick<
  typeof schema.markets.$inferSelect,
  "closesAt" | "creatorUserId" | "id" | "metadata" | "status" | "title"
>;
export type ClaimedMarketReminderDelivery = {
  delivery: MarketReminderDelivery;
  market: typeof schema.markets.$inferSelect;
  recipient: typeof schema.users.$inferSelect;
};

export function marketReminderSlotsForCloseDate(input: {
  closesAt: Date;
  now: Date;
}): Array<{ scheduledFor: Date; slotKey: string }> {
  const closeParts = zonedDateParts(input.closesAt, MARKET_REMINDER_TIME_ZONE);

  return MARKET_REMINDER_SLOT_DEFINITIONS.map((slot) => ({
    scheduledFor: zonedDateTimeToUtc({
      day: closeParts.day,
      hour: slot.hour,
      minute: 0,
      month: closeParts.month,
      second: 0,
      timeZone: MARKET_REMINDER_TIME_ZONE,
      year: closeParts.year,
    }),
    slotKey: slot.slotKey,
  })).filter((slot) => slot.scheduledFor > input.now && slot.scheduledFor < input.closesAt);
}

export async function scheduleMarketReminderDeliveries(input: {
  db: ReminderExecutor;
  market: ReminderMarket;
  now?: Date;
}): Promise<{ insertedCount: number; skippedReason?: string; slots: string[] }> {
  const now = input.now ?? new Date();

  if (input.market.status !== "open") {
    return { insertedCount: 0, skippedReason: "market_not_open", slots: [] };
  }

  if (!input.market.closesAt) {
    return { insertedCount: 0, skippedReason: "missing_closes_at", slots: [] };
  }

  if (!getDiscordMetadata(input.market.metadata).threadId) {
    return { insertedCount: 0, skippedReason: "missing_discord_thread_id", slots: [] };
  }

  const slots = marketReminderSlotsForCloseDate({
    closesAt: input.market.closesAt,
    now,
  });

  if (slots.length === 0) {
    return { insertedCount: 0, skippedReason: "no_future_slots", slots: [] };
  }

  let insertedCount = 0;

  for (const slot of slots) {
    const inserted = await input.db
      .insert(schema.marketReminderDeliveries)
      .values({
        id: createId(),
        marketId: input.market.id,
        nextAttemptAt: slot.scheduledFor,
        recipientUserId: input.market.creatorUserId,
        scheduledFor: slot.scheduledFor,
        slotKey: slot.slotKey,
      })
      .onConflictDoNothing({
        target: [
          schema.marketReminderDeliveries.marketId,
          schema.marketReminderDeliveries.recipientUserId,
          schema.marketReminderDeliveries.slotKey,
        ],
      })
      .returning({ id: schema.marketReminderDeliveries.id });

    insertedCount += inserted.length;
  }

  return {
    insertedCount,
    slots: slots.map((slot) => slot.slotKey),
  };
}

export async function claimMarketReminderDelivery(input: {
  db: DbClient;
  lockTtlMs?: number;
  now?: Date;
}): Promise<ClaimedMarketReminderDelivery | null> {
  const now = input.now ?? new Date();
  const claimNow = new Date(Math.max(now.getTime(), Date.now()));
  const lockedUntil = new Date(
    now.getTime() + (input.lockTtlMs ?? DEFAULT_MARKET_REMINDER_LOCK_TTL_MS),
  );

  return input.db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(schema.marketReminderDeliveries)
      .where(
        or(
          and(
            inArray(schema.marketReminderDeliveries.status, ["pending", "failed"]),
            lte(schema.marketReminderDeliveries.nextAttemptAt, claimNow),
          ),
          and(
            eq(schema.marketReminderDeliveries.status, "processing"),
            lte(schema.marketReminderDeliveries.lockedUntil, claimNow),
          ),
        ),
      )
      .orderBy(
        asc(schema.marketReminderDeliveries.nextAttemptAt),
        asc(schema.marketReminderDeliveries.scheduledFor),
        asc(schema.marketReminderDeliveries.id),
      )
      .for("update", { skipLocked: true })
      .limit(1);

    if (!delivery) {
      return null;
    }

    const [claimedDelivery] = await tx
      .update(schema.marketReminderDeliveries)
      .set({
        lockedUntil,
        status: "processing",
        updatedAt: now,
      })
      .where(eq(schema.marketReminderDeliveries.id, delivery.id))
      .returning();

    if (!claimedDelivery) {
      throw new Error("Failed to claim market reminder delivery");
    }

    const [market] = await tx
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, claimedDelivery.marketId))
      .limit(1);

    if (!market) {
      throw new Error("Claimed market reminder has no market");
    }

    const [recipient] = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, claimedDelivery.recipientUserId))
      .limit(1);

    if (!recipient) {
      throw new Error("Claimed market reminder has no recipient");
    }

    return {
      delivery: claimedDelivery,
      market,
      recipient,
    };
  });
}

export async function markMarketReminderDelivered(input: {
  db: ReminderExecutor;
  deliveryId: string;
  discordMessageId: string;
  now?: Date;
}): Promise<MarketReminderDelivery> {
  const now = input.now ?? new Date();
  const [updated] = await input.db
    .update(schema.marketReminderDeliveries)
    .set({
      deliveredAt: now,
      discordMessageId: input.discordMessageId,
      lastError: null,
      lockedUntil: null,
      status: "delivered",
      updatedAt: now,
    })
    .where(eq(schema.marketReminderDeliveries.id, input.deliveryId))
    .returning();

  if (!updated) {
    throw new Error("Failed to mark market reminder delivered");
  }

  return updated;
}

export async function markMarketReminderSkipped(input: {
  db: ReminderExecutor;
  deliveryId: string;
  now?: Date;
  reason: string;
}): Promise<MarketReminderDelivery> {
  return updateTerminalReminder(input.db, input.deliveryId, "skipped", input.reason, input.now);
}

export async function markMarketReminderFailed(input: {
  db: ReminderExecutor;
  delivery: MarketReminderDelivery;
  error: string;
  maxAttempts?: number;
  nextAttemptAt: Date;
  now?: Date;
}): Promise<MarketReminderDelivery> {
  const now = input.now ?? new Date();
  const attempts = input.delivery.attempts + 1;
  const status: MarketReminderDeliveryStatus =
    attempts >= (input.maxAttempts ?? MARKET_REMINDER_MAX_ATTEMPTS) ? "dead" : "failed";
  const [updated] = await input.db
    .update(schema.marketReminderDeliveries)
    .set({
      attempts: sql`${schema.marketReminderDeliveries.attempts} + 1`,
      deliveredAt: status === "dead" ? now : null,
      lastError: truncateReminderError(input.error),
      lockedUntil: null,
      nextAttemptAt: status === "dead" ? now : input.nextAttemptAt,
      status,
      updatedAt: now,
    })
    .where(eq(schema.marketReminderDeliveries.id, input.delivery.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to mark market reminder failed");
  }

  return updated;
}

export function nextMarketReminderAttemptAt(input: { attempts: number; now: Date }): Date {
  const delayMs =
    MARKET_REMINDER_RETRY_DELAYS_MS[
      Math.min(input.attempts, MARKET_REMINDER_RETRY_DELAYS_MS.length - 1)
    ] ?? 900_000;

  return new Date(input.now.getTime() + delayMs);
}

export function normalizeMarketReminderBatchLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_MARKET_REMINDER_BATCH_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("MARKET_REMINDER_BATCH_LIMIT must be a positive integer");
  }

  return Math.min(limit, MAX_MARKET_REMINDER_BATCH_LIMIT);
}

async function updateTerminalReminder(
  db: ReminderExecutor,
  deliveryId: string,
  status: "skipped",
  reason: string,
  now = new Date(),
): Promise<MarketReminderDelivery> {
  const [updated] = await db
    .update(schema.marketReminderDeliveries)
    .set({
      deliveredAt: now,
      lastError: reason,
      lockedUntil: null,
      status,
      updatedAt: now,
    })
    .where(eq(schema.marketReminderDeliveries.id, deliveryId))
    .returning();

  if (!updated) {
    throw new Error(`Failed to mark market reminder ${status}`);
  }

  return updated;
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);

  return {
    day: Number(readPart(parts, "day")),
    month: Number(readPart(parts, "month")),
    year: Number(readPart(parts, "year")),
  };
}

function zonedDateTimeToUtc(input: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  timeZone: string;
  year: number;
}): Date {
  const targetUtc = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
  );
  let candidate = new Date(targetUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedDateTimeParts(candidate, input.timeZone);
    const candidateWallUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const deltaMs = candidateWallUtc - targetUtc;

    if (deltaMs === 0) {
      return candidate;
    }

    candidate = new Date(candidate.getTime() - deltaMs);
  }

  return candidate;
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const hour = Number(readPart(parts, "hour"));

  return {
    day: Number(readPart(parts, "day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(readPart(parts, "minute")),
    month: Number(readPart(parts, "month")),
    second: Number(readPart(parts, "second")),
    year: Number(readPart(parts, "year")),
  };
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Missing ${type} date part`);
  }

  return part.value;
}

function truncateReminderError(error: string): string {
  return error.length > 2_000 ? `${error.slice(0, 1_997)}...` : error;
}
