import { REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import { InsufficientFundsError } from "../errors";
import { withTransaction } from "../transaction";
import { ensureLockedRepBalance } from "./locking";
import type { Balance, RepBalance, WalletDbInput } from "../types";

export async function getBalance(input: WalletDbInput & { userId: string }): Promise<RepBalance> {
  const [balance] = await input.db
    .select()
    .from(schema.balances)
    .where(
      and(eq(schema.balances.userId, input.userId), eq(schema.balances.currency, REP_CURRENCY)),
    )
    .limit(1);

  return toRepBalance(balance, input.userId);
}

export async function setRepCreditLimit(
  input: WalletDbInput & {
    userId: string;
    creditLimitMicro: bigint;
  },
): Promise<RepBalance> {
  if (input.creditLimitMicro < 0n) {
    throw new RangeError("creditLimitMicro must be nonnegative");
  }

  return withTransaction(input, async (tx) => {
    const balance = await ensureLockedRepBalance(tx, input.userId);

    if (balance.availableAmountMicro < -input.creditLimitMicro) {
      throw new InsufficientFundsError({
        availableAmountMicro: balance.availableAmountMicro,
        creditLimitMicro: input.creditLimitMicro,
        requestedAmountMicro: 0n,
        userId: input.userId,
      });
    }

    const [updated] = await tx
      .update(schema.balances)
      .set({
        creditLimitMicro: input.creditLimitMicro,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.balances.userId, input.userId), eq(schema.balances.currency, REP_CURRENCY)),
      )
      .returning();

    if (!updated) {
      throw new Error("Failed to update REP credit limit");
    }

    return toRepBalance(updated, input.userId);
  });
}

export function toRepBalance(balance: Balance | undefined, userId: string): RepBalance {
  return {
    availableAmountMicro: balance?.availableAmountMicro ?? 0n,
    creditLimitMicro: balance?.creditLimitMicro ?? 0n,
    currency: REP_CURRENCY,
    lockedAmountMicro: balance?.lockedAmountMicro ?? 0n,
    userId,
  };
}
