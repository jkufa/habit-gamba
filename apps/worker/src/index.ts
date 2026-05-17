import { createDbClient } from "@habit-gamba/db";
import { loadBaseEnv } from "@habit-gamba/env";

import { createWorkerLogger } from "./logger";
import { runMarketLifecycleWorker } from "./service";

const env = loadBaseEnv();
const logger = createWorkerLogger({ env: env.NODE_ENV });
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });

try {
  const limit = parseOptionalPositiveInteger(process.env.MARKET_LIFECYCLE_BATCH_LIMIT);
  const result = await runMarketLifecycleWorker({
    db,
    env: env.NODE_ENV,
    ...(limit === undefined ? {} : { limit }),
    logger,
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
