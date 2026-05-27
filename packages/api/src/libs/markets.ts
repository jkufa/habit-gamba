import type { CreateBinaryMarketResult, MarketWithContracts } from "@habit-gamba/contracts";
import type { schema } from "@habit-gamba/db";
import type {
  ExchangeBuyResult,
  ExchangeListPositionsResult,
  ExchangeMarketView,
  ExchangeQuoteResult,
  ExchangeSellResult,
} from "@habit-gamba/exchange";
import type {
  CancelMarketResult as DomainCancelMarketResult,
  PreviewCancelMarketResult,
  ResolveMarketResult as DomainResolveMarketResult,
} from "@habit-gamba/resolution";
import type {
  CreateRecurringMarketSeriesResult as DomainCreateRecurringMarketSeriesResult,
  EndRecurringMarketSeriesResult as DomainEndRecurringMarketSeriesResult,
} from "@habit-gamba/recurring";

export type CreateMarketResponse = CreateBinaryMarketResult;
export type OpenMarketResponse = MarketWithContracts;
export type CloseMarketResponse = MarketWithContracts;
export type MarketResponse = ExchangeMarketView;
export type AutocompleteMarketsResponse = {
  markets: MarketWithContracts[];
};
export type QuoteMarketResponse = ExchangeQuoteResult;
export type BuyMarketResponse = ExchangeBuyResult;
export type SellMarketResponse = ExchangeSellResult;
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
export type RecurringMarketSeriesResponse = typeof schema.recurringMarketSeries.$inferSelect;
export type CreateRecurringMarketSeriesResponse = Omit<
  DomainCreateRecurringMarketSeriesResult,
  "firstMarket"
> & {
  firstMarket: ExchangeMarketView | null;
};
export type EndRecurringMarketSeriesResponse = DomainEndRecurringMarketSeriesResult;
export type MarketRefreshTradeDto = Pick<
  typeof schema.trades.$inferSelect,
  "cashDeltaMicro" | "createdAt" | "id" | "sharesDeltaMicro" | "side"
> & {
  actorDisplayName: string;
  actorHandle: string | null;
  outcome: "NO" | "YES";
};
export type MarketMetadataResponse = typeof schema.markets.$inferSelect;
