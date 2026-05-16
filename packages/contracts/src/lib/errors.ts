export class MarketNotFoundError extends Error {
  readonly code = "MARKET_NOT_FOUND" as const;

  constructor(
    readonly details: {
      marketId?: string;
      slug?: string;
    },
  ) {
    super("Market not found");
    this.name = "MarketNotFoundError";
  }
}

export class MarketConflictError extends Error {
  readonly code = "MARKET_CONFLICT" as const;

  constructor(
    readonly details: {
      slug: string;
    },
  ) {
    super("Market slug was reused with different payload");
    this.name = "MarketConflictError";
  }
}

export class MarketInvalidTransitionError extends Error {
  readonly code = "MARKET_INVALID_TRANSITION" as const;

  constructor(
    readonly details: {
      marketId: string;
      fromStatus: string;
      toStatus: string;
    },
  ) {
    super("Market lifecycle transition is not allowed");
    this.name = "MarketInvalidTransitionError";
  }
}

export class MarketResolutionUnsupportedError extends Error {
  readonly code = "MARKET_RESOLUTION_UNSUPPORTED" as const;

  constructor() {
    super("Market resolution requires betting, payout, and ledger invariant design");
    this.name = "MarketResolutionUnsupportedError";
  }
}
