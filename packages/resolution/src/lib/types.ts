import { schema } from "@habit-gamba/db";
import type { DbClient } from "@habit-gamba/db";
import type { WalletWriteResult } from "@habit-gamba/wallet";

export type ResolutionOutcome = "NO" | "YES";
export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type ResolutionExecutor = DbClient | DbTransaction;
export type Market = typeof schema.markets.$inferSelect;
export type MarketContract = typeof schema.contracts.$inferSelect;
export type Position = typeof schema.positions.$inferSelect;
export type Resolution = typeof schema.resolutions.$inferSelect;
export type Cancellation = typeof schema.cancellations.$inferSelect;
export type LedgerEntry = WalletWriteResult["ledgerEntry"];

export type ResolutionConfig = {
  creatorPenaltyBps?: number;
};

export type ResolveMarketInput = ResolutionConfig & {
  db: DbClient;
  evidence?: Record<string, unknown>;
  marketId: string;
  outcome: ResolutionOutcome;
  resolvedByUserId: string;
  resolvedAt?: Date;
};

export type ResolveMarketResult = {
  idempotent: boolean;
  ledgerEntries: LedgerEntry[];
  market: Market;
  resolution: Resolution;
};

export type CancelMarketInput = ResolutionConfig & {
  db: DbClient;
  marketId: string;
  reason: string;
  cancelledAt?: Date;
};

export type CancelMarketResult = {
  cancellation: Cancellation;
  idempotent: boolean;
  ledgerEntries: LedgerEntry[];
  market: Market;
};

export type AutoCancelExpiredMarketsInput = ResolutionConfig & {
  db: DbClient;
  limit?: number;
  now: Date;
  reason?: string;
};

export type AutoCancelExpiredMarketsResult = {
  cancelledCount: number;
  cancelledMarketIds: string[];
  errors: Array<{
    marketId: string;
    message: string;
  }>;
};
