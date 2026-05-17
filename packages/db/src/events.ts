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

  return event;
}
