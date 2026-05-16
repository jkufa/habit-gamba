export class InsufficientFundsError extends Error {
  readonly code = "INSUFFICIENT_FUNDS" as const;

  constructor(
    readonly details: {
      userId: string;
      availableAmountMicro: bigint;
      creditLimitMicro: bigint;
      requestedAmountMicro: bigint;
    },
  ) {
    super("Insufficient REP balance");
    this.name = "InsufficientFundsError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;

  constructor(
    readonly details: {
      idempotencyKey: string;
    },
  ) {
    super("Idempotency key was reused with different wallet write payload");
    this.name = "IdempotencyConflictError";
  }
}
