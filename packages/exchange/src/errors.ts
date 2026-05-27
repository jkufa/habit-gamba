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
    super("Exchange idempotency key was reused with different trade payload");
    this.name = "ExchangeIdempotencyConflictError";
  }
}

export class ExchangeTradeAmountTooSmallError extends RangeError {
  readonly code = "EXCHANGE_TRADE_AMOUNT_TOO_SMALL" as const;

  constructor(
    readonly details: {
      amountMicro: string;
      minimumAmountMicro: string;
    },
  ) {
    super(`amountMicro must be at least ${details.minimumAmountMicro} (0.01 REP/contracts)`);
    this.name = "ExchangeTradeAmountTooSmallError";
  }
}

export class ExchangeInsufficientPositionError extends Error {
  readonly code = "EXCHANGE_INSUFFICIENT_POSITION" as const;

  constructor(
    readonly details: {
      availableSharesMicro: string;
      contractId: string;
      requestedSharesMicro: string;
      userId: string;
    },
  ) {
    super("Insufficient position for sell");
    this.name = "ExchangeInsufficientPositionError";
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
    super("Market does not accept trades");
    this.name = "MarketNotTradeableError";
  }
}

export class ExchangeSelfTradeError extends Error {
  readonly code = "EXCHANGE_SELF_TRADE" as const;

  constructor(
    readonly details: {
      marketId: string;
      userId: string;
    },
  ) {
    super("Market creator cannot trade on their own market");
    this.name = "ExchangeSelfTradeError";
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
