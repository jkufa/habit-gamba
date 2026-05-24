import { createDbClient, createId, schema } from "@habit-gamba/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createRecurringMarketSeries,
  openAtForLocalDate,
  runRecurringMarketWorker,
} from "../index";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe("recurring markets", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 1 });

  beforeAll(async () => {
    await migrate(client.db, {
      migrationsFolder: new URL("../../../db/drizzle", import.meta.url).pathname,
    });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("opens the draft as first occurrence when today is selected", async () => {
    const creatorUserId = await insertCreator();
    const marketId = await insertDraftMarket(creatorUserId, "Will first occurrence open?");
    const result = await createRecurringMarketSeries({
      creatorUserId,
      daysOfWeekMask: 1 << 1,
      db: client.db,
      marketId,
      now: new Date("2026-05-18T16:00:00.000Z"),
    });

    expect(result.firstMarket?.id).toBe(marketId);
    expect(result.firstMarket?.status).toBe("open");
    expect(result.firstMarket?.recurrenceDate).toBe("2026-05-18");
    expect(result.firstMarket?.closesAt?.toISOString()).toBe("2026-05-19T03:59:59.000Z");
    expect(result.series.nextOpenAt?.toISOString()).toBe("2026-05-25T04:00:00.000Z");
  });

  it("keeps the draft as template and creates due occurrences idempotently", async () => {
    const creatorUserId = await insertCreator();
    const marketId = await insertDraftMarket(creatorUserId, "Will worker create occurrence?");
    const created = await createRecurringMarketSeries({
      creatorUserId,
      daysOfWeekMask: 1 << 2,
      db: client.db,
      endsOn: "2026-05-19",
      marketId,
      metadata: { discord: { channelId: "channel_1", guildId: "guild_1" } },
      now: new Date("2026-05-18T16:00:00.000Z"),
    });

    expect(created.firstMarket).toBeNull();
    expect(created.series.nextOpenAt?.toISOString()).toBe("2026-05-19T04:00:00.000Z");

    const firstRun = await runRecurringMarketWorker({
      db: client.db,
      now: new Date("2026-05-19T04:05:00.000Z"),
    });
    const secondRun = await runRecurringMarketWorker({
      db: client.db,
      now: new Date("2026-05-19T04:06:00.000Z"),
    });

    expect(firstRun.createdCount).toBe(1);
    expect(secondRun.createdCount).toBe(0);

    const occurrence = await client.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, firstRun.createdMarketIds[0] ?? "missing"))
      .then((rows) => rows[0]);

    expect(occurrence?.status).toBe("open");
    expect(occurrence?.recurrenceDate).toBe("2026-05-19");
    expect(occurrence?.openedAt?.toISOString()).toBe("2026-05-19T04:00:00.000Z");
    expect(occurrence?.closesAt?.toISOString()).toBe("2026-05-20T03:59:59.000Z");

    const contracts = await client.db
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.marketId, occurrence?.id ?? "missing"));

    expect(contracts).toHaveLength(2);

    const [series] = await client.db
      .select()
      .from(schema.recurringMarketSeries)
      .where(eq(schema.recurringMarketSeries.id, created.series.id));

    expect(series?.nextOpenAt).toBeNull();
  });

  it("does not create markets for ended series", async () => {
    const creatorUserId = await insertCreator();
    const marketId = await insertDraftMarket(creatorUserId, "Will ended series stop?");
    const created = await createRecurringMarketSeries({
      creatorUserId,
      daysOfWeekMask: 1 << 2,
      db: client.db,
      marketId,
      now: new Date("2026-05-18T16:00:00.000Z"),
    });

    await client.db
      .update(schema.recurringMarketSeries)
      .set({ nextOpenAt: null, status: "ended" })
      .where(eq(schema.recurringMarketSeries.id, created.series.id));

    const result = await runRecurringMarketWorker({
      db: client.db,
      now: openAtForLocalDate("2026-05-19"),
    });

    expect(result.createdCount).toBe(0);
  });

  async function insertCreator(): Promise<string> {
    const userId = createId();

    await client.db.insert(schema.users).values({
      displayName: "Recurring Creator",
      id: userId,
      provider: "test",
      providerUserId: `recurring-${userId}`,
    });

    return userId;
  }

  async function insertDraftMarket(creatorUserId: string, title: string): Promise<string> {
    const marketId = createId();

    await client.db.insert(schema.markets).values({
      creatorUserId,
      id: marketId,
      slug: `recurring-${createId().toLowerCase()}`,
      title,
    });
    await client.db.insert(schema.contracts).values([
      {
        id: createId(),
        marketId,
        outcome: "YES",
        title: "YES",
      },
      {
        id: createId(),
        marketId,
        outcome: "NO",
        title: "NO",
      },
    ]);

    return marketId;
  }
});
