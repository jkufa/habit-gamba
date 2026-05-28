import { loadBaseEnv } from "@habit-gamba/env";
import { eq, sql } from "drizzle-orm";

import { createDbClient } from "../src/client";
import { DEFAULT_COMMUNITY_ID } from "../src/community";
import { repToMicro } from "../src/currency";
import {
  balances,
  communities,
  communityMemberships,
  contracts,
  ledgerEntries,
  markets,
  users,
} from "../src/schema";
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
    await tx
      .insert(communities)
      .values({
        displayName: "Habit Gamba",
        id: DEFAULT_COMMUNITY_ID,
        metadata: { default: true, seed: true },
        provider: "system",
        providerCommunityId: "default",
        slug: "habit-gamba",
      })
      .onConflictDoNothing();

    for (const user of seedUsers) {
      await tx
        .insert(users)
        .values({
          id: user.id,
          provider: user.provider,
          providerUserId: user.providerUserId,
          displayName: user.displayName,
          handle: user.handle,
          metadata: { seed: true },
        })
        .onConflictDoUpdate({
          target: [users.provider, users.providerUserId],
          set: {
            displayName: user.displayName,
            handle: user.handle,
            metadata: { seed: true },
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(balances)
        .values({
          communityId: DEFAULT_COMMUNITY_ID,
          id: user.balanceId,
          userId: user.id,
          availableAmountMicro: user.grant,
        })
        .onConflictDoNothing();

      await tx
        .insert(ledgerEntries)
        .values({
          amountDeltaMicro: user.grant,
          balanceAfterMicro: user.grant,
          communityId: DEFAULT_COMMUNITY_ID,
          id: user.grantLedgerId,
          idempotencyKey: `seed:user:${user.providerUserId}:grant`,
          metadata: { seed: true },
          reason: "seed_grant",
          sourceId: user.id,
          sourceType: "seed_user_grant",
          userId: user.id,
        })
        .onConflictDoNothing();

      await tx
        .insert(communityMemberships)
        .values({
          communityId: DEFAULT_COMMUNITY_ID,
          displayNameSnapshot: user.displayName,
          id: `${user.id}:default-membership`,
          metadata: { seed: true },
          providerMemberId: user.providerUserId,
          userId: user.id,
        })
        .onConflictDoNothing();

      await tx
        .update(balances)
        .set({
          availableAmountMicro: sql`
            (
              select coalesce(sum(${ledgerEntries.amountDeltaMicro}), 0)::bigint
              from ${ledgerEntries}
              where ${ledgerEntries.userId} = ${user.id}
                and ${ledgerEntries.currency} = ${balances.currency}
                and ${ledgerEntries.communityId} = ${balances.communityId}
            )
          `,
          updatedAt: new Date(),
        })
        .where(eq(balances.userId, user.id));
    }

    await tx
      .insert(markets)
      .values({
        id: "01KRS1ETXBNDAJD2KZT4TTHT62",
        closesAt: new Date("2027-01-01T00:00:00.000Z"),
        communityId: DEFAULT_COMMUNITY_ID,
        creatorUserId: "01KRS1E7CZHGTQQ5N7Y7KD31Z7",
        description: "Demo binary habit market for local development.",
        liquidityParameterMicro: repToMicro(100n),
        metadata: { seed: true },
        openedAt: new Date("2026-01-01T00:00:00.000Z"),
        slug: "demo-daily-habit",
        status: "open",
        title: "Will Demo User complete today's habit?",
      })
      .onConflictDoUpdate({
        target: [markets.communityId, markets.slug],
        set: {
          closesAt: new Date("2027-01-01T00:00:00.000Z"),
          description: "Demo binary habit market for local development.",
          liquidityParameterMicro: repToMicro(100n),
          metadata: { seed: true },
          openedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: "open",
          title: "Will Demo User complete today's habit?",
          updatedAt: new Date(),
        },
      });

    for (const contract of [
      {
        id: "01KRS1ETXBNBCQ99YYA4351CWY",
        outcome: "YES" as const,
        title: "Yes",
      },
      {
        id: "01KRS1ETXBDDQJR5JQZ99KDBWG",
        outcome: "NO" as const,
        title: "No",
      },
    ]) {
      await tx
        .insert(contracts)
        .values({
          id: contract.id,
          marketId: "01KRS1ETXBNDAJD2KZT4TTHT62",
          outcome: contract.outcome,
          title: contract.title,
        })
        .onConflictDoUpdate({
          target: [contracts.marketId, contracts.outcome],
          set: {
            title: contract.title,
            updatedAt: new Date(),
          },
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
