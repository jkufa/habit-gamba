import type { DbClient, schema } from "@habit-gamba/db";
import type { WalletWriteResult } from "@habit-gamba/wallet";

import type { LmsrOutcome, LmsrPrices, LmsrQuote } from "./lmsr";

export type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type ExchangeExecutor = DbClient | DbTransaction;
export type ExchangeConfig = {
  defaultLiquidityMicro: bigint;
};

export type ExchangeService = {
  buy: (input: ExchangeBuyInput) => Promise<ExchangeBuyResult>;
  getMarket: (input: ExchangeGetMarketInput) => Promise<ExchangeMarketView>;
  quoteBuy: (input: ExchangeQuoteBuyInput) => Promise<ExchangeQuoteResult>;
};

export type ExchangeBuyInput = {
  amountMicro: bigint;
  contractId: string;
  db: DbClient;
  idempotencyKey: string;
  now?: Date;
  outcome: LmsrOutcome;
  userId: string;
};

export type ExchangeQuoteBuyInput = {
  amountMicro: bigint;
  contractId: string;
  db: DbClient;
  now?: Date;
  outcome: LmsrOutcome;
};

export type ExchangeGetMarketInput =
  | {
      contractId: string;
      db: DbClient;
      marketId?: never;
    }
  | {
      contractId?: never;
      db: DbClient;
      marketId: string;
    };

export type Market = typeof schema.markets.$inferSelect;
export type MarketContract = typeof schema.contracts.$inferSelect;
export type Trade = typeof schema.trades.$inferSelect;
export type Position = typeof schema.positions.$inferSelect;

export type ExchangeMarketView = Market & {
  contracts: [MarketContract, MarketContract];
  prices: LmsrPrices;
};

export type ExchangeQuoteResult = LmsrQuote & {
  market: ExchangeMarketView;
};

export type ExchangeBuyResult = {
  idempotent: boolean;
  ledgerEntry: WalletWriteResult["ledgerEntry"];
  market: ExchangeMarketView;
  position: Position;
  quote: LmsrQuote;
  trade: Trade;
};
