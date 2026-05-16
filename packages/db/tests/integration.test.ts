import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedDatabase } from "../scripts/seed";
import { createDbClient } from "../src/client";
import { balances, contracts, ledgerEntries, markets, users } from "../src/schema";

const databaseUrl = process.env.DATABASE_URL;
const maybeDescribe = databaseUrl ? describe : describe.skip;

maybeDescribe("database foundation", () => {
  const client = createDbClient({ databaseUrl: databaseUrl ?? "", max: 1 });

  beforeAll(async () => {
    await migrate(client.db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await client.sql.end();
  });

  it("applies migrations and seeds idempotently", async () => {
    await seedDatabase(client.db);
    await seedDatabase(client.db);

    const seededUsers = await client.db.select().from(users);
    const seededMarkets = await client.db.select().from(markets);
    const seededContracts = await client.db.select().from(contracts);
    const seededLedgerEntries = await client.db.select().from(ledgerEntries);
    const demoMarket = seededMarkets.find((market) => market.slug === "demo-daily-habit");

    expect(seededUsers.length).toBeGreaterThanOrEqual(3);
    expect(demoMarket).toBeDefined();
    expect(seededContracts.filter((contract) => contract.marketId === demoMarket?.id)).toHaveLength(
      2,
    );
    expect(
      seededLedgerEntries.filter((entry) => entry.sourceType === "seed_user_grant"),
    ).toHaveLength(3);
  });

  it("keeps seeded balance projection equal to ledger sums", async () => {
    const seededBalances = await client.db.select().from(balances);
    const seededLedgerEntries = await client.db.select().from(ledgerEntries);

    for (const balance of seededBalances) {
      const ledgerTotal = seededLedgerEntries
        .filter((entry) => entry.userId === balance.userId && entry.currency === balance.currency)
        .reduce((sum, entry) => sum + entry.amountDeltaMicro, 0n);

      expect(balance.availableAmountMicro).toBe(ledgerTotal);
    }
  });
});
