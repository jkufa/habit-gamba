export class ExchangeConfigError extends Error {
  readonly code = "EXCHANGE_CONFIG_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "ExchangeConfigError";
  }
}

export class ExchangeIdempotencyConflictError extends Error {
  readonly code = "EXCHANGE_IDEMPOTENCY_CONFLICT" as const;

  constructor(
    readonly details: {
      idempotencyKey: string;
    },
  ) {
    super("Exchange idempotency key was reused with different buy payload");
    this.name = "ExchangeIdempotencyConflictError";
  }
}

export class MarketNotTradeableError extends Error {
  readonly code = "MARKET_NOT_TRADEABLE" as const;

  constructor(
    readonly details: {
      closesAt: Date | null;
      marketId: string;
      now: Date;
      status: string;
    },
  ) {
    super("Market does not accept bets");
    this.name = "MarketNotTradeableError";
  }
}

export class ExchangeMarketNotFoundError extends Error {
  readonly code = "EXCHANGE_MARKET_NOT_FOUND" as const;

  constructor(
    readonly details: {
      contractId?: string;
      marketId?: string;
    },
  ) {
    super("Exchange market not found");
    this.name = "ExchangeMarketNotFoundError";
  }
}
