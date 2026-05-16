import type { DbClient, schema } from "@habit-gamba/db";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type MarketExecutor = DbClient | DbTransaction;
export type Market = typeof schema.markets.$inferSelect;
export type MarketContract = typeof schema.contracts.$inferSelect;
export type MarketStatus = Market["status"];

export type MarketDbInput = {
  db: DbClient;
  tx?: DbTransaction;
};

export type MarketWithContracts = Market & {
  contracts: [MarketContract, MarketContract];
};

export type CreateBinaryMarketInput = MarketDbInput & {
  id?: string;
  yesContractId?: string;
  noContractId?: string;
  creatorUserId: string;
  slug: string;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateBinaryMarketResult = {
  market: MarketWithContracts;
  idempotent: boolean;
};

export type OpenMarketInput = MarketDbInput & {
  marketId: string;
  closesAt: Date;
  openedAt?: Date;
};

export type CloseMarketInput = MarketDbInput & {
  marketId: string;
  closedAt?: Date;
};

export type VoidMarketInput = MarketDbInput & {
  marketId: string;
  voidedAt?: Date;
};

export type GetMarketByIdInput = MarketDbInput & {
  marketId: string;
};

export type GetMarketBySlugInput = MarketDbInput & {
  slug: string;
};

export type MarketListCursor = {
  createdAt: Date;
  id: string;
};

export type ListMarketsInput = MarketDbInput & {
  cursor?: MarketListCursor;
  limit?: number;
  creatorUserId?: string;
  statuses?: MarketStatus[];
};

export type ListMarketsResult = {
  markets: MarketWithContracts[];
  nextCursor: MarketListCursor | null;
};
