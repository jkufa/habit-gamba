export class ResolutionConfigError extends Error {
  readonly code = "RESOLUTION_CONFIG_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "ResolutionConfigError";
  }
}

export class ResolutionMarketNotFoundError extends Error {
  readonly code = "RESOLUTION_MARKET_NOT_FOUND" as const;

  constructor(readonly details: { marketId: string }) {
    super("Resolution market not found");
    this.name = "ResolutionMarketNotFoundError";
  }
}

export class ResolutionInvalidTransitionError extends Error {
  readonly code = "RESOLUTION_INVALID_TRANSITION" as const;

  constructor(readonly details: { fromStatus: string; marketId: string; toStatus: string }) {
    super("Resolution lifecycle transition is not allowed");
    this.name = "ResolutionInvalidTransitionError";
  }
}

export class ResolutionIdempotencyConflictError extends Error {
  readonly code = "RESOLUTION_IDEMPOTENCY_CONFLICT" as const;

  constructor(readonly details: { marketId: string }) {
    super("Terminal market settlement does not match requested payload");
    this.name = "ResolutionIdempotencyConflictError";
  }
}
