export {
  ResolutionConfigError,
  ResolutionIdempotencyConflictError,
  ResolutionInvalidTransitionError,
  ResolutionMarketNotFoundError,
} from "./lib/errors";
export { checkResolutionInvariant } from "./lib/invariants";
export { autoCancelExpiredMarkets, cancelMarket, resolveMarket } from "./lib/service";
export type {
  AutoCancelExpiredMarketsInput,
  AutoCancelExpiredMarketsResult,
  Cancellation,
  CancelMarketInput,
  CancelMarketResult,
  DbTransaction,
  LedgerEntry,
  Market,
  MarketContract,
  Position,
  Resolution,
  ResolutionConfig,
  ResolutionExecutor,
  ResolutionOutcome,
  ResolveMarketInput,
  ResolveMarketResult,
} from "./lib/types";
