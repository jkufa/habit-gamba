import { createDbClient } from "@habit-gamba/db";
import { loadServerEnv } from "@habit-gamba/env";

import { createApp } from "./app";

const env = loadServerEnv();
const { db, sql } = createDbClient({ databaseUrl: env.DATABASE_URL });
const app = createApp({
  botApiToken: env.BOT_API_TOKEN,
  db,
  pingDb: async () => {
    await sql`select 1`;
  },
});

const server = Bun.serve({
  fetch: app.fetch,
  hostname: env.SERVER_HOST,
  port: env.SERVER_PORT,
});

console.log(`server listening on http://${server.hostname}:${server.port}`);
