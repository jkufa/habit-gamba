import { createId, REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import type { Balance, WalletExecutor } from "../types";

export async function ensureLockedRepBalance(
  tx: WalletExecutor,
  input: { communityId: string; userId: string },
): Promise<Balance> {
  await tx
    .insert(schema.balances)
    .values({
      communityId: input.communityId,
      id: createId(),
      userId: input.userId,
    })
    .onConflictDoNothing({
      target: [schema.balances.userId, schema.balances.currency, schema.balances.communityId],
    });

  const [balance] = await tx
    .select()
    .from(schema.balances)
    .where(
      and(
        eq(schema.balances.userId, input.userId),
        eq(schema.balances.currency, REP_CURRENCY),
        eq(schema.balances.communityId, input.communityId),
      ),
    )
    .for("update")
    .limit(1);

  if (!balance) {
    throw new Error("Failed to lock REP balance");
  }

  return balance;
}
