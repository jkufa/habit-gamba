import { autoVoidUnresolvedMarkets } from "@habit-gamba/resolution";
import type { DbClient } from "@habit-gamba/db";
import { createLogger, createMetricsRegistry, createWideEvent } from "@habit-gamba/logger";
import type { Logger, MetricsRegistry, Tracer } from "@habit-gamba/logger";

export const DEFAULT_MARKET_LIFECYCLE_BATCH_LIMIT = 100;
export const MAX_MARKET_LIFECYCLE_BATCH_LIMIT = 1_000;

export type MarketLifecycleWorkerInput = {
  db: DbClient;
  env: string;
  limit?: number;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: Date;
  tracer?: Tracer;
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
  const logger =
    input.logger ??
    createLogger({
      env: input.env,
      service: "market-lifecycle-worker",
    });
  const metrics = input.metrics ?? createMetricsRegistry();
  const runs = metrics.counter("habit_gamba_market_lifecycle_worker_runs_total", "Worker runs");
  const duration = metrics.histogram(
    "habit_gamba_market_lifecycle_worker_duration_ms",
    "Worker run duration in milliseconds",
  );
  const voided = metrics.counter(
    "habit_gamba_market_lifecycle_worker_voided_markets_total",
    "Markets voided by the lifecycle worker",
  );
  const wideEvent = createWideEvent(logger, "market_lifecycle_worker.run", {
    limit: normalizeMarketLifecycleBatchLimit(input.limit),
  });
  const span = input.tracer?.startSpan("market_lifecycle_worker.run");
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

  runs.add(1, { outcome });
  duration.observe(durationMs, { outcome });
  voided.add(result.voidedCount, { outcome });
  wideEvent.finish(outcome, {
    duration_ms: durationMs,
    error_count: result.errors.length,
    errors: result.errors,
    voided_count: result.voidedCount,
    voided_market_ids: result.voidedMarketIds,
  });
  await span?.end(outcome === "success" ? "ok" : "error", {
    duration_ms: durationMs,
    error_count: result.errors.length,
    outcome,
    voided_count: result.voidedCount,
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
