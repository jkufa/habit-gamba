import { createId, REP_CURRENCY, schema } from "@habit-gamba/db";
import { and, eq } from "drizzle-orm";

import { UserGrantConflictError } from "./errors";
import { withTransaction } from "./transaction";
import type {
  Balance,
  EnsureSeedRepGrantInput,
  EnsureSeedRepGrantResult,
  LedgerEntry,
  UserExecutor,
} from "./types";

const SEED_GRANT_SOURCE_TYPE = "seed_user_grant";

export async function ensureSeedRepGrant(
  input: EnsureSeedRepGrantInput,
): Promise<EnsureSeedRepGrantResult> {
  if (input.amountMicro < 0n) {
    throw new RangeError("amountMicro must be nonnegative");
  }

  return withTransaction(input, async (tx) => {
    const existingLedgerEntry = await findLedgerEntry(tx, input.idempotencyKey);

    if (existingLedgerEntry) {
      return {
        balance: await ensureLockedRepBalance(tx, input),
        idempotent: true,
        ledgerEntry: assertSameSeedGrant(input, existingLedgerEntry),
      };
    }

    const balance = await ensureLockedRepBalance(tx, input);
    const lockedExistingLedgerEntry = await findLedgerEntry(tx, input.idempotencyKey);

    if (lockedExistingLedgerEntry) {
      return {
        balance,
        idempotent: true,
        ledgerEntry: assertSameSeedGrant(input, lockedExistingLedgerEntry),
      };
    }

    const nextAvailableAmountMicro = balance.availableAmountMicro + input.amountMicro;
    const [updatedBalance] = await tx
      .update(schema.balances)
      .set({
        availableAmountMicro: nextAvailableAmountMicro,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.balances.userId, input.userId),
          eq(schema.balances.currency, REP_CURRENCY),
          eq(schema.balances.communityId, input.communityId),
        ),
      )
      .returning();

    if (!updatedBalance) {
      throw new Error("Failed to update seed REP balance");
    }

    const [ledgerEntry] = await tx
      .insert(schema.ledgerEntries)
      .values({
        amountDeltaMicro: input.amountMicro,
        balanceAfterMicro: nextAvailableAmountMicro,
        currency: REP_CURRENCY,
        communityId: input.communityId,
        id: input.ledgerEntryId ?? createId(),
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        reason: "seed_grant",
        sourceId: input.sourceId ?? input.userId,
        sourceType: SEED_GRANT_SOURCE_TYPE,
        userId: input.userId,
      })
      .returning();

    if (!ledgerEntry) {
      throw new Error("Failed to create seed REP ledger entry");
    }

    return {
      balance: updatedBalance,
      idempotent: false,
      ledgerEntry,
    };
  });
}

async function ensureLockedRepBalance(
  tx: UserExecutor,
  input: Pick<EnsureSeedRepGrantInput, "balanceId" | "communityId" | "userId">,
): Promise<Balance> {
  await tx
    .insert(schema.balances)
    .values({
      id: input.balanceId ?? createId(),
      communityId: input.communityId,
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
    throw new Error("Failed to lock seed REP balance");
  }

  return balance;
}

async function findLedgerEntry(
  tx: UserExecutor,
  idempotencyKey: string,
): Promise<LedgerEntry | null> {
  const [ledgerEntry] = await tx
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.idempotencyKey, idempotencyKey))
    .limit(1);

  return ledgerEntry ?? null;
}

function assertSameSeedGrant(
  input: EnsureSeedRepGrantInput,
  ledgerEntry: LedgerEntry,
): LedgerEntry {
  if (
    ledgerEntry.amountDeltaMicro !== input.amountMicro ||
    ledgerEntry.communityId !== input.communityId ||
    ledgerEntry.reason !== "seed_grant" ||
    ledgerEntry.sourceId !== (input.sourceId ?? input.userId) ||
    ledgerEntry.sourceType !== SEED_GRANT_SOURCE_TYPE ||
    ledgerEntry.userId !== input.userId ||
    stableJson(ledgerEntry.metadata) !== stableJson(input.metadata ?? {})
  ) {
    throw new UserGrantConflictError({ idempotencyKey: input.idempotencyKey });
  }

  return ledgerEntry;
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
