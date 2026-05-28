import { REP_CURRENCY, schema } from "@habit-gamba/db";
import type { DbClient } from "@habit-gamba/db";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type WalletExecutor = DbClient | DbTransaction;
export type LedgerEntry = typeof schema.ledgerEntries.$inferSelect;
export type Balance = typeof schema.balances.$inferSelect;
export type LedgerReason = LedgerEntry["reason"];

export type WalletDbInput = {
  db: DbClient;
  tx?: DbTransaction;
};

export type RepWriteInput = WalletDbInput & {
  amountMicro: bigint;
  communityId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  sourceId: string;
  sourceType: string;
  userId: string;
};

export type RepBalance = {
  communityId: string | null;
  currency: typeof REP_CURRENCY;
  availableAmountMicro: bigint;
  lockedAmountMicro: bigint;
  creditLimitMicro: bigint;
  userId: string;
};

export type WalletWriteResult = {
  ledgerEntry: LedgerEntry;
  balance: RepBalance;
  idempotent: boolean;
};

export type RepLedgerInvariantMismatch = {
  userId: string;
  communityId: string | null;
  currency: typeof REP_CURRENCY;
  cachedAvailableAmountMicro: bigint;
  ledgerAmountMicro: bigint;
  deltaMicro: bigint;
};

export type RepLedgerInvariantReport =
  | {
      ok: true;
      mismatches: [];
    }
  | {
      ok: false;
      mismatches: RepLedgerInvariantMismatch[];
    };
