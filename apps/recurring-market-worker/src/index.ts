import { createDbClient } from "@habit-gamba/db";
import { loadBaseEnv } from "@habit-gamba/env";
import { createLogger, createMetricsRegistry } from "@habit-gamba/logger";

import { parseOptionalPositiveInteger, runRecurringMarketWorkerService } from "./service";

const env = loadBaseEnv();
process.env.SERVICE_NAME = "recurring-market-worker";
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "recurring-market-worker",
});
const metrics = createMetricsRegistry();
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });

try {
  const limit = parseOptionalPositiveInteger(process.env.RECURRING_MARKET_BATCH_LIMIT);
  const result = await runRecurringMarketWorkerService({
    db,
    env: env.NODE_ENV,
    ...(limit === undefined ? {} : { limit }),
    logger,
    metrics,
  });

  await sql.end();
  process.exit(result.outcome === "success" ? 0 : 1);
} catch (error) {
  logger.error("recurring_market_worker.crash", {
    error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    outcome: "failure",
  });
  await sql.end();
  process.exit(1);
}
