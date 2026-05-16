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

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadBaseEnv(source: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(source);
}

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}
