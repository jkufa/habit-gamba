import { DEFAULT_COMMUNITY_ID, createDbClient, createId, schema } from "@habit-gamba/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeMarket,
  createBinaryMarket,
  getMarketById,
  getMarketBySlug,
  listMarkets,
  MarketConflictError,
  MarketInvalidTransitionError,
  MarketResolutionUnsupportedError,
  openMarket,
  resolveMarket,
  voidMarket,
} from "../..";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe("contract market lifecycle", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 1 });

  beforeAll(async () => {
    await migrate(client.db, {
      migrationsFolder: new URL("../../../../db/drizzle", import.meta.url).pathname,
    });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("creates binary markets idempotently and reads them by id and slug", async () => {
    const creatorUserId = await insertCreator();
    const slug = `market-${createId().toLowerCase()}`;

    const first = await createBinaryMarket({
      communityId: DEFAULT_COMMUNITY_ID,
      creatorUserId,
      db: client.db,
      description: "Lifecycle market",
      slug,
      title: "Will this lifecycle market exist?",
    });
    const second = await createBinaryMarket({
      communityId: DEFAULT_COMMUNITY_ID,
      creatorUserId,
      db: client.db,
      description: "Lifecycle market",
      slug,
      title: "Will this lifecycle market exist?",
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.market.id).toBe(first.market.id);
    expect(first.market.status).toBe("draft");
    expect(first.market.contracts.map((contract) => contract.outcome).sort()).toEqual([
      "NO",
      "YES",
    ]);

    await expect(
      createBinaryMarket({
        communityId: DEFAULT_COMMUNITY_ID,
        creatorUserId,
        db: client.db,
        description: "Changed",
        slug,
        title: "Will this lifecycle market exist?",
      }),
    ).rejects.toThrow(MarketConflictError);

    const byId = await getMarketById({ db: client.db, marketId: first.market.id });
    const bySlug = await getMarketBySlug({
      communityId: DEFAULT_COMMUNITY_ID,
      db: client.db,
      slug,
    });

    expect(byId?.id).toBe(first.market.id);
    expect(bySlug?.id).toBe(first.market.id);
  });

  it("opens, closes, voids, rejects invalid transitions, and lists with cursor pages", async () => {
    const creatorUserId = await insertCreator();
    const slug = `transition-${createId().toLowerCase()}`;
    const { market } = await createBinaryMarket({
      communityId: DEFAULT_COMMUNITY_ID,
      creatorUserId,
      db: client.db,
      slug,
      title: "Will transitions work?",
    });

    await expect(
      openMarket({
        closesAt: new Date("2027-01-01T00:00:00.000Z"),
        db: client.db,
        marketId: market.id,
        openedAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow(RangeError);

    const opened = await openMarket({
      closesAt: new Date("2027-01-02T00:00:00.000Z"),
      db: client.db,
      marketId: market.id,
      openedAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    expect(opened.status).toBe("open");

    await expect(
      openMarket({
        closesAt: new Date("2027-01-03T00:00:00.000Z"),
        db: client.db,
        marketId: market.id,
      }),
    ).rejects.toThrow(MarketInvalidTransitionError);

    const closed = await closeMarket({ db: client.db, marketId: market.id });

    expect(closed.status).toBe("closed");

    const voided = await voidMarket({ db: client.db, marketId: market.id });

    expect(voided.status).toBe("void");

    await expect(voidMarket({ db: client.db, marketId: market.id })).rejects.toThrow(
      MarketInvalidTransitionError,
    );
    await expect(resolveMarket()).rejects.toThrow(MarketResolutionUnsupportedError);

    const firstPage = await listMarkets({
      creatorUserId,
      db: client.db,
      limit: 1,
    });
    const secondPage = firstPage.nextCursor
      ? await listMarkets({
          creatorUserId,
          cursor: firstPage.nextCursor,
          db: client.db,
          limit: 1,
        })
      : null;

    expect(firstPage.markets).toHaveLength(1);
    expect(firstPage.markets[0]?.contracts).toHaveLength(2);
    expect(secondPage?.markets.length ?? 0).toBeLessThanOrEqual(1);
  });

  async function insertCreator(): Promise<string> {
    const userId = createId();

    await client.db.insert(schema.users).values({
      displayName: "Contract Creator",
      id: userId,
      provider: "test",
      providerUserId: `creator-${userId}`,
    });

    return userId;
  }
});
