import type { LogFields, ServiceName } from "./logger";

export type SpanStatus = "error" | "ok";

export type Span = {
  add: (fields: LogFields) => void;
  end: (status?: SpanStatus, fields?: LogFields) => Promise<void>;
  spanId: string;
  traceId: string;
};

export type Tracer = {
  startSpan: (name: string, fields?: LogFields) => Span;
};

export type TracerInput = {
  endpoint?: string | undefined;
  env: string;
  service: ServiceName;
};

export function createTracer(input: TracerInput): Tracer {
  return {
    startSpan: (name, fields = {}) => {
      const span: SpanRecord = {
        attributes: { env: input.env, service: input.service, ...fields },
        endUnixNano: null,
        name,
        service: input.service,
        spanId: randomHex(8),
        startUnixNano: unixNanoNow(),
        status: "ok",
        traceId: asTraceId(fields.trace_id) ?? randomTraceId(),
      };

      return {
        add: (nextFields) => {
          Object.assign(span.attributes, nextFields);
        },
        end: async (status = "ok", nextFields = {}) => {
          span.status = status;
          span.endUnixNano = unixNanoNow();
          Object.assign(span.attributes, nextFields);
          await exportSpan(input.endpoint, span);
        },
        spanId: span.spanId,
        traceId: span.traceId,
      };
    },
  };
}

export function randomTraceId(): string {
  return randomHex(16);
}

type SpanRecord = {
  attributes: LogFields;
  endUnixNano: string | null;
  name: string;
  service: ServiceName;
  spanId: string;
  startUnixNano: string;
  status: SpanStatus;
  traceId: string;
};

async function exportSpan(endpoint: string | undefined, span: SpanRecord) {
  if (!endpoint || !span.endUnixNano) {
    return;
  }

  try {
    await fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: span.service } },
                {
                  key: "deployment.environment",
                  value: { stringValue: String(span.attributes.env) },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "@habit-gamba/logger" },
                spans: [
                  {
                    attributes: toOtlpAttributes(span.attributes),
                    endTimeUnixNano: span.endUnixNano,
                    name: span.name,
                    spanId: span.spanId,
                    startTimeUnixNano: span.startUnixNano,
                    status: { code: span.status === "ok" ? 1 : 2 },
                    traceId: span.traceId,
                  },
                ],
              },
            ],
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch {
    // Telemetry export must not affect product behavior.
  }
}

function toOtlpAttributes(fields: LogFields) {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined || value === null) {
      return [];
    }

    return [{ key, value: toOtlpValue(value) }];
  });
}

function toOtlpValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }

  if (typeof value === "bigint") {
    return { intValue: value.toString() };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  return { stringValue: JSON.stringify(value) };
}

function asTraceId(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? value : null;
}

function unixNanoNow(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
