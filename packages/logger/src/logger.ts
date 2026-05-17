export type LogLevel = "debug" | "error" | "info" | "warn";
export type ServiceName = "bot" | "event-worker" | "market-lifecycle-worker" | "server";
export type LogFields = Record<string, unknown>;

export type Logger = {
  error: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

export type CreateLoggerInput = {
  commitHash?: string | undefined;
  env: string;
  level?: LogLevel | undefined;
  service: ServiceName;
  version?: string | undefined;
  write?: (line: string) => void;
};

export type WideEvent = {
  add: (fields: LogFields) => void;
  error: (error: unknown, fields?: LogFields) => void;
  finish: (outcome: "failure" | "success", fields?: LogFields) => void;
};

const REDACTED_KEY_PARTS = [
  "authorization",
  "bot_api_token",
  "displayname",
  "display_name",
  "handle",
  "message",
  "provider_user_id",
  "provideruserid",
  "raw",
  "secret",
  "token",
];

export function createLogger(input: CreateLoggerInput): Logger {
  const write = input.write ?? console.log;
  const baseFields = {
    commit_hash: input.commitHash ?? process.env.COMMIT_HASH ?? "unknown",
    env: input.env,
    service: input.service,
    version: input.version ?? process.env.APP_VERSION ?? "unknown",
  };

  return createLoggerWithBase(write, normalizeLevel(input.level), baseFields);
}

export function createWideEvent(logger: Logger, event: string, fields: LogFields = {}): WideEvent {
  const startedAt = performance.now();
  const wideFields: LogFields = { ...fields };
  let finished = false;

  return {
    add: (nextFields) => {
      Object.assign(wideFields, nextFields);
    },
    error: (error, nextFields) => {
      if (finished) {
        return;
      }

      finished = true;
      logger.error(event, {
        ...wideFields,
        ...nextFields,
        duration_ms: Math.round(performance.now() - startedAt),
        error,
        outcome: "failure",
      });
    },
    finish: (outcome, nextFields) => {
      if (finished) {
        return;
      }

      finished = true;
      logger[outcome === "success" ? "info" : "error"](event, {
        ...wideFields,
        ...nextFields,
        duration_ms: Math.round(performance.now() - startedAt),
        outcome,
      });
    },
  };
}

function createLoggerWithBase(
  write: (line: string) => void,
  threshold: LogLevel,
  baseFields: LogFields,
): Logger {
  const logger: Logger = {
    child: (fields) => createLoggerWithBase(write, threshold, { ...baseFields, ...fields }),
    error: (event, fields) => {
      writeLog(write, threshold, "error", event, baseFields, fields);
    },
    info: (event, fields) => {
      writeLog(write, threshold, "info", event, baseFields, fields);
    },
  };

  return logger;
}

function writeLog(
  write: (line: string) => void,
  threshold: LogLevel,
  level: "error" | "info",
  event: string,
  baseFields: LogFields,
  fields: LogFields | undefined,
) {
  if (!shouldLog(threshold, level)) {
    return;
  }

  write(
    JSON.stringify(
      sanitize({
        timestamp: new Date().toISOString(),
        level,
        ...baseFields,
        event,
        ...fields,
      }),
      jsonReplacer,
    ),
  );
}

function shouldLog(threshold: LogLevel, level: "error" | "info") {
  if (level === "error") {
    return true;
  }

  return threshold === "debug" || threshold === "info";
}

function normalizeLevel(level: LogLevel | undefined): LogLevel {
  return level ?? "info";
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry));
  }

  if (!value || typeof value !== "object" || value instanceof Date || value instanceof Error) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (shouldRedactKey(key)) {
        return [];
      }

      return [[key, sanitize(entry)]];
    }),
  );
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

  return REDACTED_KEY_PARTS.some((part) => normalized.includes(part));
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
    };
  }

  return value;
}
