import { createId, REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import type { Balance, WalletExecutor } from "../types";

export async function ensureLockedRepBalance(tx: WalletExecutor, userId: string): Promise<Balance> {
  await tx
    .insert(schema.balances)
    .values({
      id: createId(),
      userId,
    })
    .onConflictDoNothing({
      target: [schema.balances.userId, schema.balances.currency],
    });

  const [balance] = await tx
    .select()
    .from(schema.balances)
    .where(and(eq(schema.balances.userId, userId), eq(schema.balances.currency, REP_CURRENCY)))
    .for("update")
    .limit(1);

  if (!balance) {
    throw new Error("Failed to lock REP balance");
  }

  return balance;
}
