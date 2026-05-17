import { createDbClient } from "@habit-gamba/db";
import { loadBaseEnv } from "@habit-gamba/env";
import { createLogger, createMetricsRegistry, createTracer } from "@habit-gamba/logger";

import { runMarketLifecycleWorker } from "./service";

const env = loadBaseEnv();
process.env.SERVICE_NAME = "market-lifecycle-worker";
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "market-lifecycle-worker",
});
const metrics = createMetricsRegistry();
const tracer = createTracer({
  endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  env: env.NODE_ENV,
  service: "market-lifecycle-worker",
});
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });

try {
  const limit = parseOptionalPositiveInteger(process.env.MARKET_LIFECYCLE_BATCH_LIMIT);
  const result = await runMarketLifecycleWorker({
    db,
    env: env.NODE_ENV,
    ...(limit === undefined ? {} : { limit }),
    logger,
    metrics,
    tracer,
  });

  await sql.end();
  process.exit(result.outcome === "success" ? 0 : 1);
} catch (error) {
  logger.error("market_lifecycle_worker.crash", {
    error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    outcome: "failure",
  });
  await sql.end();
  process.exit(1);
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError("MARKET_LIFECYCLE_BATCH_LIMIT must be a positive integer");
  }

  return parsed;
}
