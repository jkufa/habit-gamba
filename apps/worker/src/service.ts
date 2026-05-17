import { autoVoidUnresolvedMarkets } from "@habit-gamba/resolution";
import type { DbClient } from "@habit-gamba/db";

import { createWorkerLogger } from "./logger";
import type { WorkerLogger } from "./logger";

export const DEFAULT_MARKET_LIFECYCLE_BATCH_LIMIT = 100;
export const MAX_MARKET_LIFECYCLE_BATCH_LIMIT = 1_000;

export type MarketLifecycleWorkerInput = {
  db: DbClient;
  env: string;
  limit?: number;
  logger?: WorkerLogger;
  now?: Date;
};

export type MarketLifecycleWorkerResult = {
  durationMs: number;
  errors: Array<{
    marketId?: string;
    message: string;
  }>;
  outcome: "failure" | "success";
  voidedCount: number;
  voidedMarketIds: string[];
};

export async function runMarketLifecycleWorker(
  input: MarketLifecycleWorkerInput,
): Promise<MarketLifecycleWorkerResult> {
  const logger = input.logger ?? createWorkerLogger({ env: input.env });
  const startedAt = performance.now();
  const now = input.now ?? new Date();
  const limit = normalizeMarketLifecycleBatchLimit(input.limit);
  const result = await autoVoidUnresolvedMarkets({
    db: input.db,
    limit,
    now,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const outcome = result.errors.length > 0 ? "failure" : "success";
  const summary: MarketLifecycleWorkerResult = {
    durationMs,
    errors: result.errors,
    outcome,
    voidedCount: result.voidedCount,
    voidedMarketIds: result.voidedMarketIds,
  };

  logger[outcome === "success" ? "info" : "error"]("market_lifecycle_worker.run", {
    duration_ms: durationMs,
    error_count: result.errors.length,
    errors: result.errors,
    outcome,
    voided_count: result.voidedCount,
    voided_market_ids: result.voidedMarketIds,
  });

  return summary;
}

export function normalizeMarketLifecycleBatchLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_MARKET_LIFECYCLE_BATCH_LIMIT;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError("MARKET_LIFECYCLE_BATCH_LIMIT must be a positive integer");
  }

  return Math.min(limit, MAX_MARKET_LIFECYCLE_BATCH_LIMIT);
}
