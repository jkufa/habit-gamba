import { createBinaryMarket, openMarket } from "@habit-gamba/contracts";
import { createDbClient, createId, schema } from "@habit-gamba/db";
import { createMetricsRegistry, type Logger } from "@habit-gamba/logger";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMarketLifecycleWorker } from "../service";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;
const migrationsFolder = new URL("../../../../packages/db/drizzle", import.meta.url).pathname;

maybeDescribe("market lifecycle worker integration", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 4 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("voids an unresolved open market whose close time is now", async () => {
    const now = new Date();
    const creatorId = await insertUser("due-now");
    const { market } = await createBinaryMarket({
      creatorUserId: creatorId,
      db: client.db,
      slug: `worker-test-due-now-${createId().toLowerCase()}`,
      title: "Worker test due now",
    });
    await openMarket({
      closesAt: now,
      db: client.db,
      marketId: market.id,
      openedAt: new Date(now.getTime() - 1_000),
    });
    const logger: Logger = {
      child: () => logger,
      error: () => {},
      info: () => {},
    };
    const metrics = createMetricsRegistry();

    const result = await runMarketLifecycleWorker({
      db: client.db,
      env: "test",
      logger,
      metrics,
    });
    const [updatedMarket] = await client.db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, market.id))
      .limit(1);
    const [event] = await client.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.aggregateId, market.id))
      .limit(1);

    expect(result.outcome).toBe("success");
    expect(result.voidedMarketIds).toContain(market.id);
    expect(metrics.render()).toContain("habit_gamba_market_lifecycle_worker_runs_total");
    expect(updatedMarket?.status).toBe("void");
    expect(event?.type).toBe("market.voided");
  });

  async function insertUser(label: string): Promise<string> {
    const userId = createId();

    await client.db.insert(schema.users).values({
      displayName: `Worker Test ${label}`,
      id: userId,
      provider: "worker-test",
      providerUserId: `${label}-${userId}`,
    });

    return userId;
  }
});
