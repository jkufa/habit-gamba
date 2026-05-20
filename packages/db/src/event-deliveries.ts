import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { DbClient } from "./client";
import { createId } from "./id";
import * as schema from "./schema";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DeliveryExecutor = DbClient | DbTransaction;
export type EventDelivery = typeof schema.eventDeliveries.$inferSelect;
export type EventDeliveryStatus = EventDelivery["status"];
export type ClaimEventDeliveryInput = {
  consumerName: string;
  db: DbClient;
  lockTtlMs: number;
  now?: Date;
  supportedEventTypes: string[];
};
export type ClaimedEventDelivery = {
  delivery: EventDelivery;
  event: typeof schema.events.$inferSelect;
  market: typeof schema.markets.$inferSelect | null;
};

export async function materializeEventDeliveries(input: {
  consumerName: string;
  db: DeliveryExecutor;
  limit?: number;
  supportedEventTypes: string[];
}): Promise<number> {
  if (input.supportedEventTypes.length === 0) {
    return 0;
  }

  const events = await input.db
    .select({ id: schema.events.id })
    .from(schema.events)
    .leftJoin(
      schema.eventDeliveries,
      and(
        eq(schema.eventDeliveries.eventId, schema.events.id),
        eq(schema.eventDeliveries.consumerName, input.consumerName),
      ),
    )
    .where(
      and(
        inArray(schema.events.type, input.supportedEventTypes),
        isNull(schema.eventDeliveries.id),
      ),
    )
    .orderBy(asc(schema.events.occurredAt), asc(schema.events.id))
    .limit(input.limit ?? 100);
  let insertedCount = 0;

  for (const event of events) {
    const inserted = await input.db
      .insert(schema.eventDeliveries)
      .values({
        consumerName: input.consumerName,
        eventId: event.id,
        id: createId(),
      })
      .onConflictDoNothing({
        target: [schema.eventDeliveries.eventId, schema.eventDeliveries.consumerName],
      })
      .returning({ id: schema.eventDeliveries.id });

    insertedCount += inserted.length;
  }

  return insertedCount;
}

export async function claimEventDelivery(
  input: ClaimEventDeliveryInput,
): Promise<ClaimedEventDelivery | null> {
  const now = input.now ?? new Date();
  const claimNow = new Date(Math.max(now.getTime(), Date.now()));
  const lockedUntil = new Date(now.getTime() + input.lockTtlMs);

  return input.db.transaction(async (tx) => {
    await materializeEventDeliveries({
      consumerName: input.consumerName,
      db: tx,
      limit: 100,
      supportedEventTypes: input.supportedEventTypes,
    });

    const [delivery] = await tx
      .select()
      .from(schema.eventDeliveries)
      .where(
        and(
          eq(schema.eventDeliveries.consumerName, input.consumerName),
          or(
            and(
              inArray(schema.eventDeliveries.status, ["pending", "failed"]),
              lte(schema.eventDeliveries.nextAttemptAt, claimNow),
            ),
            and(
              eq(schema.eventDeliveries.status, "processing"),
              lte(schema.eventDeliveries.lockedUntil, claimNow),
            ),
          ),
        ),
      )
      .orderBy(asc(schema.eventDeliveries.nextAttemptAt), asc(schema.eventDeliveries.createdAt))
      .for("update", { skipLocked: true })
      .limit(1);

    if (!delivery) {
      return null;
    }

    const [claimedDelivery] = await tx
      .update(schema.eventDeliveries)
      .set({
        lockedUntil,
        status: "processing",
        updatedAt: now,
      })
      .where(eq(schema.eventDeliveries.id, delivery.id))
      .returning();

    if (!claimedDelivery) {
      throw new Error("Failed to claim event delivery");
    }

    const [event] = await tx
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, claimedDelivery.eventId))
      .limit(1);

    if (!event) {
      throw new Error("Claimed event delivery has no event");
    }

    const [market] =
      event.aggregateType === "market"
        ? await tx
            .select()
            .from(schema.markets)
            .where(eq(schema.markets.id, event.aggregateId))
            .limit(1)
        : [];

    return {
      delivery: claimedDelivery,
      event,
      market: market ?? null,
    };
  });
}

export async function markEventDeliveryDelivered(input: {
  db: DeliveryExecutor;
  deliveryId: string;
  now?: Date;
}): Promise<EventDelivery> {
  return updateTerminalDelivery(input.db, input.deliveryId, "delivered", input.now);
}

export async function markEventDeliverySkipped(input: {
  db: DeliveryExecutor;
  deliveryId: string;
  now?: Date;
  reason: string;
}): Promise<EventDelivery> {
  return updateTerminalDelivery(input.db, input.deliveryId, "skipped", input.now, input.reason);
}

export async function markEventDeliveryFailed(input: {
  db: DeliveryExecutor;
  delivery: EventDelivery;
  error: string;
  maxAttempts: number;
  nextAttemptAt: Date;
  now?: Date;
}): Promise<EventDelivery> {
  const now = input.now ?? new Date();
  const attempts = input.delivery.attempts + 1;
  const status: EventDeliveryStatus = attempts >= input.maxAttempts ? "dead" : "failed";
  const [updated] = await input.db
    .update(schema.eventDeliveries)
    .set({
      attempts: sql`${schema.eventDeliveries.attempts} + 1`,
      deliveredAt: status === "dead" ? now : null,
      lastError: truncateDeliveryError(input.error),
      lockedUntil: null,
      nextAttemptAt: status === "dead" ? now : input.nextAttemptAt,
      status,
      updatedAt: now,
    })
    .where(eq(schema.eventDeliveries.id, input.delivery.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to mark event delivery failed");
  }

  return updated;
}

async function updateTerminalDelivery(
  db: DeliveryExecutor,
  deliveryId: string,
  status: "delivered" | "skipped",
  now = new Date(),
  reason?: string,
): Promise<EventDelivery> {
  const [updated] = await db
    .update(schema.eventDeliveries)
    .set({
      deliveredAt: now,
      lastError: reason,
      lockedUntil: null,
      status,
      updatedAt: now,
    })
    .where(eq(schema.eventDeliveries.id, deliveryId))
    .returning();

  if (!updated) {
    throw new Error(`Failed to mark event delivery ${status}`);
  }

  return updated;
}

function truncateDeliveryError(error: string): string {
  return error.length > 2_000 ? `${error.slice(0, 1_997)}...` : error;
}
