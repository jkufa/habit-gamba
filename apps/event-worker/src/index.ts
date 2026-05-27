import { createDbClient } from "@habit-gamba/db";
import { loadEventWorkerEnv } from "@habit-gamba/env";
import { createLogger, createMetricsRegistry, createTracer } from "@habit-gamba/logger";

import { createDiscordDeliveryProvider, createDiscordRest } from "./discord";
import { runEventWorkerLoop } from "./service";

const env = loadEventWorkerEnv();
process.env.SERVICE_NAME = "event-worker";
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "event-worker",
});
const metrics = createMetricsRegistry();
const tracer = createTracer({
  endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  env: env.NODE_ENV,
  service: "event-worker",
});
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });
const controller = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("event_worker_shutdown", { signal });
    controller.abort();
  });
}

try {
  await runEventWorkerLoop({
    db,
    deliveryProvider: createDiscordDeliveryProvider({
      db,
      logger,
      rest: createDiscordRest(env.DISCORD_BOT_TOKEN),
    }),
    env: env.NODE_ENV,
    lockTtlMs: env.EVENT_WORKER_LOCK_TTL_MS,
    logger,
    metrics,
    pollIntervalMs: env.EVENT_WORKER_POLL_INTERVAL_MS,
    signal: controller.signal,
    tracer,
  });
  await sql.end();
} catch (error) {
  logger.error("event_worker_crash", {
    error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
    outcome: "failure",
  });
  await sql.end();
  process.exit(1);
}
