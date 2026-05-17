import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import {
  MarketConflictError,
  MarketInvalidTransitionError,
  MarketNotFoundError,
} from "@habit-gamba/contracts";
import {
  ExchangeIdempotencyConflictError,
  ExchangeMarketNotFoundError,
  MarketNotTradeableError,
} from "@habit-gamba/exchange";
import {
  ResolutionIdempotencyConflictError,
  ResolutionInvalidTransitionError,
  ResolutionMarketNotFoundError,
} from "@habit-gamba/resolution";
import { UserNotFoundError } from "@habit-gamba/users";
import { IdempotencyConflictError, InsufficientFundsError } from "@habit-gamba/wallet";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ErrorBody = {
  error: {
    code: string;
    details?: unknown;
    message: string;
  };
};

export function ok(data: unknown): { data: unknown } {
  return { data: serializeJson(data) };
}

export function errorBody(error: unknown): { body: ErrorBody; status: number } {
  const mapped = mapError(error);

  return {
    body: {
      error: serializeJson({
        code: mapped.code,
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
        message: mapped.message,
      }) as ErrorBody["error"],
    },
    status: mapped.status,
  };
}

export function serializeJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeJson(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeJson(entry)]),
    );
  }

  return value;
}

function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new ApiError(400, "VALIDATION_ERROR", "Request validation failed", error.issues);
  }

  if (error instanceof SyntaxError || error instanceof HTTPException) {
    return new ApiError(400, "BAD_REQUEST", "Request body is invalid");
  }

  if (error instanceof UserNotFoundError) {
    return new ApiError(401, "UNAUTHORIZED", "Authenticated user was not found", error.details);
  }

  if (error instanceof MarketNotFoundError) {
    return new ApiError(404, error.code, error.message, error.details);
  }

  if (
    error instanceof ExchangeMarketNotFoundError ||
    error instanceof ResolutionMarketNotFoundError
  ) {
    return new ApiError(404, error.code, error.message, error.details);
  }

  if (
    error instanceof MarketConflictError ||
    error instanceof ExchangeIdempotencyConflictError ||
    error instanceof ResolutionIdempotencyConflictError ||
    error instanceof IdempotencyConflictError
  ) {
    return new ApiError(409, getErrorCode(error, "CONFLICT"), error.message, getDetails(error));
  }

  if (
    error instanceof MarketInvalidTransitionError ||
    error instanceof MarketNotTradeableError ||
    error instanceof ResolutionInvalidTransitionError ||
    error instanceof InsufficientFundsError ||
    error instanceof RangeError
  ) {
    return new ApiError(
      422,
      getErrorCode(error, "UNPROCESSABLE_ENTITY"),
      error.message,
      getDetails(error),
    );
  }

  console.error(error);

  return new ApiError(500, "INTERNAL_SERVER_ERROR", "Internal server error");
}

function getErrorCode(error: Error, fallback: string): string {
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  return fallback;
}

function getDetails(error: Error): unknown {
  if ("details" in error) {
    return error.details;
  }

  return {};
}
