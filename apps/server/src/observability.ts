import { createMetricsRegistry, createTracer, randomTraceId } from "@habit-gamba/logger";
import type { Logger, MetricsRegistry, Tracer } from "@habit-gamba/logger";
import type { MiddlewareHandler } from "hono";

export type ServerObservability = {
  httpRequests: ReturnType<MetricsRegistry["counter"]>;
  httpRequestDuration: ReturnType<MetricsRegistry["histogram"]>;
  logger: Logger;
  metrics: MetricsRegistry;
  tracer: Tracer;
};

export function createServerObservability(input: {
  env: string;
  logger: Logger;
  otlpEndpoint?: string | undefined;
}): ServerObservability {
  const metrics = createMetricsRegistry();

  return {
    httpRequestDuration: metrics.histogram(
      "habit_gamba_http_request_duration_ms",
      "HTTP request duration in milliseconds",
    ),
    httpRequests: metrics.counter("habit_gamba_http_requests_total", "HTTP requests"),
    logger: input.logger,
    metrics,
    tracer: createTracer({
      endpoint: input.otlpEndpoint,
      env: input.env,
      service: "server",
    }),
  };
}

export function serverObservabilityMiddleware(
  observability: ServerObservability,
): MiddlewareHandler {
  return async (context, next) => {
    const requestId = context.req.header("X-Request-Id")?.trim() || crypto.randomUUID();
    const traceId = randomTraceId();
    const path = routePath(context.req);
    const span = observability.tracer.startSpan("http.request", {
      method: context.req.method,
      path,
      request_id: requestId,
      trace_id: traceId,
    });
    const startedAt = performance.now();
    const logger = observability.logger.child({ request_id: requestId, trace_id: traceId });

    context.header("X-Request-Id", requestId);

    try {
      await next();

      const durationMs = Math.round(performance.now() - startedAt);
      const status = context.res.status;
      const outcome = status >= 500 ? "failure" : "success";
      const fields = {
        duration_ms: durationMs,
        method: context.req.method,
        outcome,
        path,
        status_code: status,
      };

      observability.httpRequests.add(1, {
        method: context.req.method,
        outcome,
        path,
        status_code: String(status),
      });
      observability.httpRequestDuration.observe(durationMs, {
        method: context.req.method,
        outcome,
        path,
      });
      logger[outcome === "success" ? "info" : "error"]("http_request", fields);
      await span.end(outcome === "success" ? "ok" : "error", fields);
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const fields = {
        duration_ms: durationMs,
        error,
        method: context.req.method,
        outcome: "failure",
        path,
      };

      observability.httpRequests.add(1, {
        method: context.req.method,
        outcome: "failure",
        path,
        status_code: "500",
      });
      observability.httpRequestDuration.observe(durationMs, {
        method: context.req.method,
        outcome: "failure",
        path,
      });
      logger.error("http_request", fields);
      await span.end("error", fields);
      throw error;
    }
  };
}

function routePath(request: { path: string; routePath?: string }): string {
  return request.routePath ?? request.path.replace(/\/[0-9A-HJKMNP-TV-Z]{26}/g, "/:id");
}
