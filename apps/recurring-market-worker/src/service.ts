import { runRecurringMarketWorker } from "@habit-gamba/recurring";
import type { DbClient } from "@habit-gamba/db";
import { createLogger, createMetricsRegistry, createWideEvent } from "@habit-gamba/logger";
import type { Logger, MetricsRegistry } from "@habit-gamba/logger";

export type RecurringMarketWorkerInput = {
  db: DbClient;
  env: string;
  limit?: number;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: Date;
};

export type RecurringMarketWorkerResult = {
  createdCount: number;
  createdMarketIds: string[];
  durationMs: number;
  errors: Array<{ message: string; seriesId?: string }>;
  outcome: "failure" | "success";
};

export async function runRecurringMarketWorkerService(
  input: RecurringMarketWorkerInput,
): Promise<RecurringMarketWorkerResult> {
  const logger =
    input.logger ??
    createLogger({
      env: input.env,
      service: "recurring-market-worker",
    });
  const metrics = input.metrics ?? createMetricsRegistry();
  const runs = metrics.counter("habit_gamba_recurring_market_worker_runs_total", "Worker runs");
  const created = metrics.counter(
    "habit_gamba_recurring_market_worker_created_markets_total",
    "Markets created by recurring worker",
  );
  const startedAt = performance.now();
  const wideEvent = createWideEvent(logger, "recurring_market_worker.run", {
    limit: input.limit,
  });
  const result = await runRecurringMarketWorker({
    db: input.db,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const outcome = result.errors.length > 0 ? "failure" : "success";

  runs.add(1, { outcome });
  created.add(result.createdCount, { outcome });
  wideEvent.finish(outcome, {
    created_count: result.createdCount,
    created_market_ids: result.createdMarketIds,
    duration_ms: durationMs,
    error_count: result.errors.length,
    errors: result.errors,
  });

  return {
    ...result,
    durationMs,
    outcome,
  };
}

export function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError("RECURRING_MARKET_BATCH_LIMIT must be a positive integer");
  }

  return parsed;
}
