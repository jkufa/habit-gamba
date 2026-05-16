import { createDbClient } from "@habit-gamba/db";
import { loadServerEnv } from "@habit-gamba/env";
import { Hono } from "hono";

const env = loadServerEnv();
const { sql } = createDbClient({ databaseUrl: env.DATABASE_URL });

const app = new Hono();

app.get("/health", (context) =>
  context.json({
    ok: true,
    service: "server",
  }),
);

app.get("/health/db", async (context) => {
  await sql`select 1`;

  return context.json({
    ok: true,
    service: "postgres",
  });
});

const server = Bun.serve({
  fetch: app.fetch,
  hostname: env.SERVER_HOST,
  port: env.SERVER_PORT,
});

console.log(`server listening on http://${server.hostname}:${server.port}`);
