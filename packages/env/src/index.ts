import { z } from "zod";

export const nodeEnvSchema = z.enum(["development", "test", "production"]);
export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: logLevelSchema.default("info"),
  NODE_ENV: nodeEnvSchema.default("development"),
});

export const serverEnvSchema = baseEnvSchema.extend({
  SERVER_HOST: z.string().default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().positive().max(65_535).default(3000),
});

export const botEnvSchema = baseEnvSchema.extend({
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().min(1).optional(),
  DEV_GUILD_ID: z.string().min(1).optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type BotEnv = BaseEnv & {
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_DEV_GUILD_ID: string;
};
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadBaseEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(source);
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

export function loadBotEnv(source: NodeJS.ProcessEnv = process.env): BotEnv {
  const parsed = botEnvSchema.parse(source);
  const devGuildId = parsed.DISCORD_DEV_GUILD_ID ?? parsed.DEV_GUILD_ID;

  if (!devGuildId) {
    throw new Error("DISCORD_DEV_GUILD_ID or DEV_GUILD_ID is required");
  }

  return {
    ...parsed,
    DISCORD_DEV_GUILD_ID: devGuildId,
  };
}
