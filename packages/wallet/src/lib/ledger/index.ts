import { REP_CURRENCY, schema } from "@habit-gamba/db";
import { eq } from "drizzle-orm";

import { isSameJsonObject } from "./json";
import type { LedgerEntry, LedgerReason, RepWriteInput, WalletExecutor } from "../types";

export async function findExistingLedgerEntry(
  tx: WalletExecutor,
  idempotencyKey: string,
): Promise<LedgerEntry | undefined> {
  const [ledgerEntry] = await tx
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.idempotencyKey, idempotencyKey))
    .limit(1);

  return ledgerEntry;
}

export function isSameLedgerPayload(
  ledgerEntry: LedgerEntry,
  input: RepWriteInput,
  write: {
    amountDeltaMicro: bigint;
    reason: LedgerReason;
  },
): boolean {
  return (
    ledgerEntry.userId === input.userId &&
    ledgerEntry.communityId === input.communityId &&
    ledgerEntry.currency === REP_CURRENCY &&
    ledgerEntry.amountDeltaMicro === write.amountDeltaMicro &&
    ledgerEntry.reason === write.reason &&
    ledgerEntry.sourceType === input.sourceType &&
    ledgerEntry.sourceId === input.sourceId &&
    isSameJsonObject(ledgerEntry.metadata, input.metadata ?? {})
  );
}
