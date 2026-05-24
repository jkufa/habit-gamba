import { createLogger } from "@habit-gamba/logger";
import type { Logger, LogLevel, ServiceName } from "@habit-gamba/logger";

import type { DbClient } from "./client";
import { createId } from "./id";
import * as schema from "./schema";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type EventExecutor = DbClient | DbTransaction;
export type Event = typeof schema.events.$inferSelect;

export type InsertEventInput = {
  aggregateId: string;
  aggregateType: string;
  db: DbClient;
  id?: string;
  logger?: Logger;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  tx?: DbTransaction;
  type: string;
};

export async function insertEvent(input: InsertEventInput): Promise<Event> {
  const executor = input.tx ?? input.db;
  const [event] = await executor
    .insert(schema.events)
    .values({
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      id: input.id ?? createId(),
      occurredAt: input.occurredAt ?? new Date(),
      payload: input.payload ?? {},
      type: input.type,
    })
    .returning();

  if (!event) {
    throw new Error("Failed to insert event");
  }

  (input.logger ?? createEventLogger()).info("event_inserted", {
    aggregate_id: event.aggregateId,
    aggregate_type: event.aggregateType,
    event_id: event.id,
    event_type: event.type,
    occurred_at: event.occurredAt.toISOString(),
  });

  return event;
}

function createEventLogger(): Logger {
  return createLogger({
    env: process.env.NODE_ENV ?? "development",
    level: process.env.LOG_LEVEL as LogLevel | undefined,
    service: toServiceName(process.env.SERVICE_NAME),
  });
}

function toServiceName(value: string | undefined): ServiceName {
  if (
    value === "bot" ||
    value === "event-worker" ||
    value === "market-lifecycle-worker" ||
    value === "market-reminder-worker" ||
    value === "recurring-market-worker" ||
    value === "server"
  ) {
    return value;
  }

  return "server";
}
