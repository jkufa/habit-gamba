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
  userId: string;
  amountMicro: bigint;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  metadata?: Record<string, unknown>;
};

export type RepBalance = {
  userId: string;
  currency: typeof REP_CURRENCY;
  availableAmountMicro: bigint;
  lockedAmountMicro: bigint;
  creditLimitMicro: bigint;
};

export type WalletWriteResult = {
  ledgerEntry: LedgerEntry;
  balance: RepBalance;
  idempotent: boolean;
};

export type RepLedgerInvariantMismatch = {
  userId: string;
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
