import { loadBaseEnv } from "@habit-gamba/env";
import { createBinaryMarket, openMarket } from "@habit-gamba/contracts";
import { ensureSeedRepGrant, upsertUser } from "@habit-gamba/users";
import { eq } from "drizzle-orm";

import { createDbClient } from "../src/client";
import { repToMicro } from "../src/currency";
import { markets } from "../src/schema";
import type { DbClient } from "../src/client";

const seedUsers = [
  {
    balanceId: "01KRS1E7CZPTRH6Q978DCVFAF4",
    provider: "system",
    grantLedgerId: "01KRS1ETXBZV8SY4JWXW67VKPJ",
    id: "01KRS1E7CXQPT6MSMEQ80MV8G2",
    providerUserId: "system",
    handle: "system",
    displayName: "System",
    grant: 0n,
  },
  {
    balanceId: "01KRS1E7CZ2B7E4BBN0N111W2K",
    provider: "local",
    grantLedgerId: "01KRS1ETXBAZE5MWH792KSGR1Q",
    id: "01KRS1E7CZHGTQQ5N7Y7KD31Z7",
    providerUserId: "admin",
    handle: "admin",
    displayName: "Admin",
    grant: repToMicro(10_000n),
  },
  {
    balanceId: "01KRS1E7CZDG6RTVY0SJS2423T",
    provider: "local",
    grantLedgerId: "01KRS1ETXB6QYB6DRTFFKDBXXV",
    id: "01KRS1E7CZDXZJTSASSS0EX1Z4",
    providerUserId: "demo",
    handle: "demo",
    displayName: "Demo User",
    grant: repToMicro(1_000n),
  },
] as const;

export async function seedDatabase(db: DbClient) {
  await db.transaction(async (tx) => {
    for (const user of seedUsers) {
      await upsertUser({
        db,
        tx,
        id: user.id,
        displayName: user.displayName,
        handle: user.handle,
        provider: user.provider,
        providerUserId: user.providerUserId,
      });

      await ensureSeedRepGrant({
        amountMicro: user.grant,
        balanceId: user.balanceId,
        db,
        idempotencyKey: `seed:user:${user.providerUserId}:grant`,
        ledgerEntryId: user.grantLedgerId,
        sourceId: user.id,
        tx,
        userId: user.id,
      });
    }

    const { market } = await createBinaryMarket({
      creatorUserId: "01KRS1E7CZHGTQQ5N7Y7KD31Z7",
      description: "Demo binary habit market for local development.",
      id: "01KRS1ETXBNDAJD2KZT4TTHT62",
      db,
      noContractId: "01KRS1ETXBDDQJR5JQZ99KDBWG",
      slug: "demo-daily-habit",
      title: "Will Demo User complete today's habit?",
      tx,
      yesContractId: "01KRS1ETXBNBCQ99YYA4351CWY",
    });

    if (market.status === "draft") {
      await openMarket({
        closesAt: new Date("2027-01-01T00:00:00.000Z"),
        db,
        marketId: market.id,
        openedAt: new Date("2026-01-01T00:00:00.000Z"),
        tx,
      });
    }
  });
}

if (import.meta.main) {
  const env = loadBaseEnv();
  const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL, max: 1 });

  await seedDatabase(db);

  const seededMarket = await db.query.markets.findFirst({
    where: eq(markets.slug, "demo-daily-habit"),
  });

  console.log(`Seed complete: ${seededMarket?.slug ?? "demo-daily-habit"}`);
  await sql.end();
}
