export type LogLevel = "error" | "info";
export type WorkerLogger = {
  error: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
};

export type CreateWorkerLoggerInput = {
  env: string;
  service?: string;
  write?: (line: string) => void;
};

export function createWorkerLogger(input: CreateWorkerLoggerInput): WorkerLogger {
  const service = input.service ?? "market-lifecycle-worker";
  const write = input.write ?? console.log;

  return {
    error: (event, fields) => {
      write(
        formatLog({
          env: input.env,
          event,
          ...(fields === undefined ? {} : { fields }),
          level: "error",
          service,
        }),
      );
    },
    info: (event, fields) => {
      write(
        formatLog({
          env: input.env,
          event,
          ...(fields === undefined ? {} : { fields }),
          level: "info",
          service,
        }),
      );
    },
  };
}

function formatLog(input: {
  env: string;
  event: string;
  fields?: Record<string, unknown>;
  level: LogLevel;
  service: string;
}): string {
  return JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      level: input.level,
      service: input.service,
      env: input.env,
      event: input.event,
      ...sanitizeFields(input.fields ?? {}),
    },
    jsonReplacer,
  );
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => {
      const normalized = key.toLowerCase();

      return (
        !normalized.includes("token") &&
        !normalized.includes("handle") &&
        !normalized.includes("displayname") &&
        !normalized.includes("message")
      );
    }),
  );
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  return value;
}
