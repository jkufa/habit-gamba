import { createDbClient } from "@habit-gamba/db";
import { loadServerEnv } from "@habit-gamba/env";
import { createLogger } from "@habit-gamba/logger";

import { createApp } from "./app";
import { createServerObservability } from "./observability";

const env = loadServerEnv();
process.env.SERVICE_NAME = "server";
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "server",
});
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });
const observability = createServerObservability({
  env: env.NODE_ENV,
  logger,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const app = createApp({
  botApiToken: env.BOT_API_TOKEN,
  db,
  observability,
  pingDb: async () => {
    await sql`select 1`;
  },
});

const server = Bun.serve({
  fetch: app.fetch,
  hostname: env.SERVER_HOST,
  port: env.SERVER_PORT,
});

logger.info("server_started", {
  host: server.hostname,
  port: server.port,
});
