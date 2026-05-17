import { REP_CURRENCY, schema } from "@habit-gamba/db";
import type { DbClient } from "@habit-gamba/db";
import { getUserById } from "@habit-gamba/users";
import { getBalance } from "@habit-gamba/wallet";
import { desc, eq, sql } from "drizzle-orm";

import { ApiError } from "./http";

export async function getPortfolio(input: { db: DbClient; userId: string }) {
  const user = await getUserById(input);

  if (!user) {
    throw new ApiError(404, "USER_NOT_FOUND", "User not found", { userId: input.userId });
  }

  const [balance, positions] = await Promise.all([
    getBalance(input),
    input.db
      .select({
        contract: schema.contracts,
        market: schema.markets,
        position: schema.positions,
      })
      .from(schema.positions)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.positions.contractId))
      .innerJoin(schema.markets, eq(schema.markets.id, schema.contracts.marketId))
      .where(eq(schema.positions.userId, input.userId))
      .orderBy(desc(schema.positions.updatedAt), desc(schema.positions.id)),
  ]);

  return {
    balance,
    positions,
    user,
  };
}

export async function getLeaderboard(input: { db: DbClient; limit?: number }) {
  const limit = input.limit ?? 50;
  const rows = await input.db
    .select({
      balance: {
        availableAmountMicro: schema.balances.availableAmountMicro,
        creditLimitMicro: schema.balances.creditLimitMicro,
        currency: schema.balances.currency,
        lockedAmountMicro: schema.balances.lockedAmountMicro,
        userId: schema.balances.userId,
      },
      user: schema.users,
    })
    .from(schema.users)
    .leftJoin(
      schema.balances,
      sql`${schema.balances.userId} = ${schema.users.id} and ${schema.balances.currency} = ${REP_CURRENCY}`,
    )
    .where(eq(schema.users.status, "active"))
    .orderBy(desc(sql`coalesce(${schema.balances.availableAmountMicro}, 0)`), desc(schema.users.id))
    .limit(limit);

  return {
    entries: rows.map((row, index) => {
      const balance =
        row.balance === null || row.balance.availableAmountMicro === null
          ? {
              availableAmountMicro: 0n,
              creditLimitMicro: 0n,
              currency: REP_CURRENCY,
              lockedAmountMicro: 0n,
              userId: row.user.id,
            }
          : row.balance;

      return {
        balance,
        rank: index + 1,
        user: row.user,
      };
    }),
  };
}
