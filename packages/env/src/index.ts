import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]);
export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: logLevelSchema.default("info"),
  NODE_ENV: nodeEnvSchema.default("development"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export const serviceEnvSchema = z.object({
  LOG_LEVEL: logLevelSchema.default("info"),
  NODE_ENV: nodeEnvSchema.default("development"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export const serverEnvSchema = baseEnvSchema.extend({
  BOT_API_TOKEN: z.string().min(1),
  PORT: z.coerce.number().int().positive().max(65_535).optional(),
  SERVER_HOST: z.string().default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().positive().max(65_535).optional(),
});

export const botEnvSchema = serviceEnvSchema.extend({
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().min(1).optional(),
});
export const botRuntimeEnvSchema = botEnvSchema.extend({
  API_BASE_URL: z.string().url(),
  BOT_METRICS_PORT: z.coerce.number().int().positive().max(65_535).optional(),
  BOT_API_TOKEN: z.string().min(1),
});
export const eventWorkerEnvSchema = baseEnvSchema.extend({
  DISCORD_BOT_TOKEN: z.string().min(1),
  EVENT_WORKER_LOCK_TTL_MS: z.coerce.number().int().positive().default(60_000),
  EVENT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type BotEnv = z.infer<typeof botEnvSchema>;
export type BotRuntimeEnv = z.infer<typeof botRuntimeEnvSchema>;
export type EventWorkerEnv = z.infer<typeof eventWorkerEnvSchema>;
export type ServerEnv = Omit<z.infer<typeof serverEnvSchema>, "SERVER_PORT"> & {
  SERVER_PORT: number;
};

export function loadBaseEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(source);
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.parse(source);

  return {
    ...parsed,
    SERVER_PORT: parsed.SERVER_PORT ?? parsed.PORT ?? 3000,
  };
}

export function loadBotEnv(source: NodeJS.ProcessEnv = process.env): BotEnv {
  const parsed = botEnvSchema.parse(source);
  return withDevGuildId(parsed);
}

export function loadBotRuntimeEnv(source: NodeJS.ProcessEnv = process.env): BotRuntimeEnv {
  return botRuntimeEnvSchema.parse(source);
}

export function loadEventWorkerEnv(source: NodeJS.ProcessEnv = process.env): EventWorkerEnv {
  return eventWorkerEnvSchema.parse(source);
}

export function requireDiscordDevGuildId(parsed: Pick<BotEnv, "DISCORD_DEV_GUILD_ID">): string {
  const devGuildId = parsed.DISCORD_DEV_GUILD_ID;

  if (!devGuildId) {
    throw new Error("DISCORD_DEV_GUILD_ID is required");
  }

  return devGuildId;
}

function withDevGuildId<T extends BotEnv>(parsed: T): T & { DISCORD_DEV_GUILD_ID: string } {
  return {
    ...parsed,
    DISCORD_DEV_GUILD_ID: requireDiscordDevGuildId(parsed),
  };
}
