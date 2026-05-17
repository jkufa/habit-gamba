import type { CreateBinaryMarketResult, MarketWithContracts } from "@habit-gamba/contracts";
import type { schema } from "@habit-gamba/db";
import type {
  ExchangeBuyResult,
  ExchangeListPositionsResult,
  ExchangeMarketView,
  ExchangeQuoteResult,
} from "@habit-gamba/exchange";
import type {
  CancelMarketResult as DomainCancelMarketResult,
  PreviewCancelMarketResult,
  ResolveMarketResult as DomainResolveMarketResult,
} from "@habit-gamba/resolution";

export type CreateMarketResponse = CreateBinaryMarketResult;
export type OpenMarketResponse = MarketWithContracts;
export type CloseMarketResponse = MarketWithContracts;
export type MarketResponse = ExchangeMarketView;
export type AutocompleteMarketsResponse = {
  markets: MarketWithContracts[];
};
export type QuoteMarketResponse = ExchangeQuoteResult;
export type BuyMarketResponse = ExchangeBuyResult;
export type PositionsResponse = ExchangeListPositionsResult;
export type ResolveMarketResponse = Omit<DomainResolveMarketResult, "market"> & {
  market: ExchangeMarketView;
};
export type CancelMarketResponse = Omit<DomainCancelMarketResult, "market"> & {
  market: ExchangeMarketView;
};
export type PreviewCancelResponse = PreviewCancelMarketResult;
export type RefreshTradesResponse = {
  trades: MarketRefreshTradeDto[];
};
export type MarketRefreshTradeDto = Pick<
  typeof schema.trades.$inferSelect,
  "cashDeltaMicro" | "createdAt" | "id" | "sharesDeltaMicro"
> & {
  buyerDisplayName: string;
  buyerHandle: string | null;
  outcome: "NO" | "YES";
};
export type MarketMetadataResponse = typeof schema.markets.$inferSelect;
