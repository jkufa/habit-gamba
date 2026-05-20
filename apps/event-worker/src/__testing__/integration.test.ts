import { createDbClient, createId, insertEvent, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runEventWorkerOnce, type EventDeliveryProvider } from "../service";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../packages/db/drizzle", import.meta.url).pathname;

maybeDescribe("event worker integration", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 4 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("materializes, claims, and delivers a market event", async () => {
    const now = new Date();
    const occurredAt = new Date("2000-01-01T00:00:00.000Z");
    const marketId = await insertMarket("deliver");
    const event = await insertEvent({
      aggregateId: marketId,
      aggregateType: "market",
      db: client.db,
      occurredAt,
      payload: {
        marketId,
        outcome: "YES",
      },
      type: "market.resolved",
    });
    const delivered: string[] = [];
    const provider: EventDeliveryProvider = {
      deliver: async (intent) => {
        delivered.push(intent.eventType);
        return { outcome: "delivered" };
      },
    };

    const result = await runUntilDelivery({
      consumerName: `test-deliver-${event.id}`,
      eventId: event.id,
      now,
      provider,
    });
    const delivery = await findDelivery(event.id, `test-deliver-${event.id}`);

    expect(result.outcome).toBe("delivered");
    expect(delivered).toContain("market.resolved");
    expect(delivery?.status).toBe("delivered");
    expect(delivery?.deliveredAt?.toISOString()).toBe(now.toISOString());
  });

  it("marks skipped provider outcomes", async () => {
    const now = new Date();
    const occurredAt = new Date("2000-01-02T00:00:00.000Z");
    const marketId = await insertMarket("skip");
    const event = await insertEvent({
      aggregateId: marketId,
      aggregateType: "market",
      db: client.db,
      occurredAt,
      payload: {
        marketId,
        reason: "admin",
      },
      type: "market.voided",
    });

    const result = await runUntilDelivery({
      consumerName: `test-skip-${event.id}`,
      eventId: event.id,
      now,
      provider: {
        deliver: async () => ({ outcome: "skipped", reason: "missing_discord_thread_id" }),
      },
    });
    const delivery = await findDelivery(event.id, `test-skip-${event.id}`);

    expect(result.outcome).toBe("skipped");
    expect(delivery?.status).toBe("skipped");
    expect(delivery?.lastError).toBe("missing_discord_thread_id");
  });

  async function insertMarket(label: string): Promise<string> {
    const userId = createId();
    const marketId = createId();

    await client.db.insert(schema.users).values({
      displayName: `Event Worker ${label}`,
      id: userId,
      provider: "event-worker-test",
      providerUserId: `${label}-${userId}`,
    });
    await client.db.insert(schema.markets).values({
      creatorUserId: userId,
      id: marketId,
      slug: `event-worker-${label}-${marketId.toLowerCase()}`,
      status: "resolved",
      title: `Event worker ${label}`,
    });

    return marketId;
  }

  async function findDelivery(eventId: string, consumerName: string) {
    const [delivery] = await client.db
      .select()
      .from(schema.eventDeliveries)
      .where(
        and(
          eq(schema.eventDeliveries.eventId, eventId),
          eq(schema.eventDeliveries.consumerName, consumerName),
        ),
      )
      .limit(1);

    return delivery;
  }

  async function runUntilDelivery(input: {
    consumerName: string;
    eventId: string;
    now: Date;
    provider: EventDeliveryProvider;
  }) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await runEventWorkerOnce({
        consumerName: input.consumerName,
        db: client.db,
        deliveryProvider: input.provider,
        env: "test",
        now: input.now,
      });
      const delivery = await findDelivery(input.eventId, input.consumerName);

      if (delivery?.status === "delivered" || delivery?.status === "skipped") {
        return result;
      }
    }

    throw new Error("Target delivery was not processed");
  }
});
