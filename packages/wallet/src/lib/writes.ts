import { createId, REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import { getBalance, toRepBalance } from "./balance";
import { IdempotencyConflictError, InsufficientFundsError } from "./errors";
import { findExistingLedgerEntry, isSameLedgerPayload } from "./ledger";
import { ensureLockedRepBalance } from "./balance/locking";
import { withTransaction } from "./transaction";
import type { Balance, LedgerEntry, LedgerReason, RepWriteInput, WalletWriteResult } from "./types";

export async function creditRep(input: RepWriteInput): Promise<WalletWriteResult> {
  return writeRep(input, {
    amountDeltaMicro: input.amountMicro,
    reason: "adjustment",
  });
}

export async function debitRep(input: RepWriteInput): Promise<WalletWriteResult> {
  return writeRep(input, {
    amountDeltaMicro: -input.amountMicro,
    reason: "trade",
  });
}

export async function payoutRep(input: RepWriteInput): Promise<WalletWriteResult> {
  return writeRep(input, {
    amountDeltaMicro: input.amountMicro,
    reason: "payout",
  });
}

export async function penalizeRep(input: RepWriteInput): Promise<WalletWriteResult> {
  return writeRep(input, {
    amountDeltaMicro: -input.amountMicro,
    reason: "adjustment",
  });
}

export async function refundRep(input: RepWriteInput): Promise<WalletWriteResult> {
  return writeRep(input, {
    amountDeltaMicro: input.amountMicro,
    reason: "refund",
  });
}

async function writeRep(
  input: RepWriteInput,
  write: {
    amountDeltaMicro: bigint;
    reason: LedgerReason;
  },
): Promise<WalletWriteResult> {
  if (input.amountMicro <= 0n) {
    throw new RangeError("amountMicro must be positive");
  }

  return withTransaction(input, async (tx) => {
    const existingLedgerEntry = await findExistingLedgerEntry(tx, input.idempotencyKey);

    if (existingLedgerEntry) {
      return getIdempotentResult(input, existingLedgerEntry, write);
    }

    const balance = await ensureLockedRepBalance(tx, input.userId);
    const lockedExistingLedgerEntry = await findExistingLedgerEntry(tx, input.idempotencyKey);

    if (lockedExistingLedgerEntry) {
      return getIdempotentResult(input, lockedExistingLedgerEntry, write, balance);
    }

    const nextAvailableAmountMicro = balance.availableAmountMicro + write.amountDeltaMicro;

    if (nextAvailableAmountMicro < -balance.creditLimitMicro) {
      throw new InsufficientFundsError({
        availableAmountMicro: balance.availableAmountMicro,
        creditLimitMicro: balance.creditLimitMicro,
        requestedAmountMicro: input.amountMicro,
        userId: input.userId,
      });
    }

    const [updatedBalance] = await tx
      .update(schema.balances)
      .set({
        availableAmountMicro: nextAvailableAmountMicro,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.balances.userId, input.userId), eq(schema.balances.currency, REP_CURRENCY)),
      )
      .returning();

    if (!updatedBalance) {
      throw new Error("Failed to update REP balance");
    }

    const [ledgerEntry] = await tx
      .insert(schema.ledgerEntries)
      .values({
        amountDeltaMicro: write.amountDeltaMicro,
        balanceAfterMicro: nextAvailableAmountMicro,
        currency: REP_CURRENCY,
        id: createId(),
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        reason: write.reason,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        userId: input.userId,
      })
      .returning();

    if (!ledgerEntry) {
      throw new Error("Failed to create REP ledger entry");
    }

    return {
      balance: toRepBalance(updatedBalance, input.userId),
      idempotent: false,
      ledgerEntry,
    };
  });
}

async function getIdempotentResult(
  input: RepWriteInput,
  ledgerEntry: LedgerEntry,
  write: {
    amountDeltaMicro: bigint;
    reason: LedgerReason;
  },
  lockedBalance?: Balance,
): Promise<WalletWriteResult> {
  if (!isSameLedgerPayload(ledgerEntry, input, write)) {
    throw new IdempotencyConflictError({ idempotencyKey: input.idempotencyKey });
  }

  const balance = lockedBalance
    ? toRepBalance(lockedBalance, input.userId)
    : await getBalance(input);

  return {
    balance,
    idempotent: true,
    ledgerEntry,
  };
}
