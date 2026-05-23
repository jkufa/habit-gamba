import { createDbClient } from "@habit-gamba/db";
import { loadMarketReminderWorkerEnv } from "@habit-gamba/env";
import { createLogger, createMetricsRegistry, createTracer } from "@habit-gamba/logger";

import { createDiscordReminderDeliveryProvider, createDiscordRest } from "./discord";
import { runMarketReminderWorker } from "./service";

const env = loadMarketReminderWorkerEnv();
process.env.SERVICE_NAME = "market-reminder-worker";
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "market-reminder-worker",
});
const metrics = createMetricsRegistry();
const tracer = createTracer({
  endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  env: env.NODE_ENV,
  service: "market-reminder-worker",
});
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });

try {
  const result = await runMarketReminderWorker({
    db,
    deliveryProvider: createDiscordReminderDeliveryProvider({
      rest: createDiscordRest(env.DISCORD_BOT_TOKEN),
    }),
    env: env.NODE_ENV,
    lockTtlMs: env.MARKET_REMINDER_LOCK_TTL_MS,
    logger,
    metrics,
    tracer,
    ...(env.MARKET_REMINDER_BATCH_LIMIT === undefined
      ? {}
      : { limit: env.MARKET_REMINDER_BATCH_LIMIT }),
  });

  await sql.end();
  process.exit(result.outcome === "success" ? 0 : 1);
} catch (error) {
  logger.error("market_reminder_worker.crash", {
    error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    outcome: "failure",
  });
  await sql.end();
  process.exit(1);
}
