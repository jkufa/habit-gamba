import { createDbClient, createId, schema } from "@habit-gamba/db";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  runMarketReminderDeliveryOnce,
  runMarketReminderWorker,
  type MarketReminderDeliveryProvider,
} from "../service";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../packages/db/drizzle", import.meta.url).pathname;

maybeDescribe("market reminder worker", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 4 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  beforeEach(async () => {
    await client.db
      .delete(schema.marketReminderDeliveries)
      .where(like(schema.marketReminderDeliveries.slotKey, "slot-%"));
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("claims due reminders, sends a Discord ping, and marks delivered", async () => {
    const now = new Date("2030-07-01T22:01:00.000Z");
    const { deliveryId, marketId, providerUserId } = await insertReminder({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      label: "deliver",
      now,
      scheduledFor: new Date("2030-07-01T22:00:00.000Z"),
    });
    const delivered: Array<{ content: string; threadId: string }> = [];
    const provider: MarketReminderDeliveryProvider = {
      deliver: async (intent) => {
        delivered.push({ content: intent.content, threadId: intent.threadId });
        return { discordMessageId: "discord-message-1", outcome: "delivered" };
      },
    };

    const result = await runMarketReminderDeliveryOnce({
      db: client.db,
      deliveryProvider: provider,
      env: "test",
      now,
    });
    const delivery = await findDelivery(deliveryId);

    expect(result).toMatchObject({ deliveryId, marketId, outcome: "delivered" });
    expect(delivered).toEqual([
      {
        content: `<@${providerUserId}> reminder: "Reminder deliver" closes at 11:59:59pm ET today. Add proof or resolve before then.`,
        threadId: "thread-deliver",
      },
    ]);
    expect(delivery?.status).toBe("delivered");
    expect(delivery?.discordMessageId).toBe("discord-message-1");
    expect(delivery?.deliveredAt?.toISOString()).toBe(now.toISOString());
  });

  it("retries transient delivery failures before the market closes", async () => {
    const now = new Date("2030-07-01T22:01:00.000Z");
    const { deliveryId } = await insertReminder({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      label: "retry",
      now,
      scheduledFor: new Date("2030-07-01T22:00:00.000Z"),
    });

    const result = await runMarketReminderDeliveryOnce({
      db: client.db,
      deliveryProvider: {
        deliver: async () => {
          throw new Error("discord unavailable");
        },
      },
      env: "test",
      now,
    });
    const delivery = await findDelivery(deliveryId);

    expect(result).toMatchObject({ deliveryId, error: "discord unavailable", outcome: "failed" });
    expect(delivery?.status).toBe("failed");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.nextAttemptAt.toISOString()).toBe("2030-07-01T22:02:00.000Z");
  });

  it("skips reminders after the market close deadline", async () => {
    const now = new Date("2030-07-02T04:00:00.000Z");
    const { deliveryId } = await insertReminder({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      label: "closed",
      now,
      scheduledFor: new Date("2030-07-02T02:00:00.000Z"),
    });

    const result = await runMarketReminderDeliveryOnce({
      db: client.db,
      deliveryProvider: {
        deliver: async () => {
          throw new Error("should not send");
        },
      },
      env: "test",
      now,
    });
    const delivery = await findDelivery(deliveryId);

    expect(result).toMatchObject({ deliveryId, outcome: "skipped", reason: "market_closed" });
    expect(delivery?.status).toBe("skipped");
    expect(delivery?.lastError).toBe("market_closed");
  });

  it("processes a bounded batch and reports counts", async () => {
    const now = new Date("2030-07-01T22:01:00.000Z");

    await insertReminder({
      closesAt: new Date("2030-07-02T03:59:59.000Z"),
      label: "batch",
      now,
      scheduledFor: new Date("2030-07-01T22:00:00.000Z"),
    });

    const result = await runMarketReminderWorker({
      db: client.db,
      deliveryProvider: {
        deliver: async () => ({ discordMessageId: "discord-message-batch", outcome: "delivered" }),
      },
      env: "test",
      limit: 1,
      now,
    });

    expect(result).toMatchObject({
      deliveredCount: 1,
      outcome: "success",
      processedCount: 1,
    });
  });

  async function insertReminder(input: {
    closesAt: Date;
    label: string;
    now: Date;
    scheduledFor: Date;
  }): Promise<{
    deliveryId: string;
    marketId: string;
    providerUserId: string;
    userId: string;
  }> {
    const userId = createId();
    const marketId = createId();
    const deliveryId = createId();
    const providerUserId = `discord-${input.label}-${userId}`;

    await client.db.insert(schema.users).values({
      displayName: `Reminder ${input.label}`,
      id: userId,
      provider: "discord",
      providerUserId,
    });
    await client.db.insert(schema.markets).values({
      closesAt: input.closesAt,
      creatorUserId: userId,
      id: marketId,
      metadata: {
        discord: { threadId: `thread-${input.label}` },
      },
      openedAt: new Date("2030-07-01T00:00:00.000Z"),
      slug: `reminder-worker-${input.label}-${marketId.toLowerCase()}`,
      status: "open",
      title: `Reminder ${input.label}`,
    });
    await client.db.insert(schema.marketReminderDeliveries).values({
      id: deliveryId,
      marketId,
      nextAttemptAt: input.scheduledFor,
      recipientUserId: userId,
      scheduledFor: input.scheduledFor,
      slotKey: `slot-${input.label}`,
    });

    return { deliveryId, marketId, providerUserId, userId };
  }

  async function findDelivery(deliveryId: string) {
    const [delivery] = await client.db
      .select()
      .from(schema.marketReminderDeliveries)
      .where(eq(schema.marketReminderDeliveries.id, deliveryId))
      .limit(1);

    return delivery;
  }
});
