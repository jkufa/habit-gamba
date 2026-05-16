export class UserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND" as const;

  constructor(
    readonly details: {
      userId: string;
    },
  ) {
    super("User not found");
    this.name = "UserNotFoundError";
  }
}

export class UserConflictError extends Error {
  readonly code = "USER_CONFLICT" as const;

  constructor(
    readonly details: {
      reason: string;
    },
  ) {
    super("User write conflicted with existing data");
    this.name = "UserConflictError";
  }
}

export class UserGrantConflictError extends Error {
  readonly code = "USER_GRANT_CONFLICT" as const;

  constructor(
    readonly details: {
      idempotencyKey: string;
    },
  ) {
    super("Seed REP grant key was reused with different payload");
    this.name = "UserGrantConflictError";
  }
}
