import {
  claimEventDelivery,
  markEventDeliveryDelivered,
  markEventDeliveryFailed,
  markEventDeliverySkipped,
  type ClaimedEventDelivery,
  type DbClient,
  type EventDelivery,
} from "@habit-gamba/db";
import { createLogger, createMetricsRegistry, createWideEvent } from "@habit-gamba/logger";
import type { Logger, MetricsRegistry, Tracer } from "@habit-gamba/logger";
import {
  composeMarketNotification,
  MARKET_NOTIFICATION_EVENT_TYPES,
  type MarketNotificationIntent,
} from "@habit-gamba/notification";

export const DISCORD_MARKET_NOTIFICATIONS_CONSUMER = "discord-market-notifications";
export const DEFAULT_EVENT_WORKER_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_EVENT_WORKER_LOCK_TTL_MS = 60_000;
export const EVENT_WORKER_RETRY_DELAYS_MS = [60_000, 300_000, 900_000] as const;
export const EVENT_WORKER_MAX_ATTEMPTS = EVENT_WORKER_RETRY_DELAYS_MS.length + 1;

export type EventDeliveryProvider = {
  deliver: (intent: MarketNotificationIntent) => Promise<EventDeliveryProviderResult>;
};
export type EventDeliveryProviderResult =
  | {
      outcome: "delivered";
    }
  | {
      outcome: "skipped";
      reason: string;
    };
export type EventWorkerInput = {
  consumerName?: string;
  db: DbClient;
  deliveryProvider: EventDeliveryProvider;
  env: string;
  lockTtlMs?: number;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: Date;
  tracer?: Tracer;
};
export type EventWorkerResult = {
  deliveryId?: string;
  durationMs: number;
  error?: string;
  eventId?: string;
  eventType?: string;
  outcome: "dead" | "delivered" | "failed" | "idle" | "skipped";
};

export async function runEventWorkerOnce(input: EventWorkerInput): Promise<EventWorkerResult> {
  const logger =
    input.logger ??
    createLogger({
      env: input.env,
      service: "event-worker",
    });
  const metrics = input.metrics ?? createMetricsRegistry();
  const runs = metrics.counter("habit_gamba_event_worker_deliveries_total", "Event deliveries");
  const duration = metrics.histogram(
    "habit_gamba_event_worker_delivery_duration_ms",
    "Event delivery duration in milliseconds",
  );
  const startedAt = performance.now();
  const consumerName = input.consumerName ?? DISCORD_MARKET_NOTIFICATIONS_CONSUMER;
  const now = input.now ?? new Date();
  const claimed = await claimEventDelivery({
    consumerName,
    db: input.db,
    lockTtlMs: input.lockTtlMs ?? DEFAULT_EVENT_WORKER_LOCK_TTL_MS,
    now,
    supportedEventTypes: [...MARKET_NOTIFICATION_EVENT_TYPES],
  });

  if (!claimed) {
    runs.add(1, { outcome: "idle" });
    return {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: "idle",
    };
  }

  const wideEvent = createWideEvent(logger, "event_worker.delivery", {
    consumer_name: consumerName,
    delivery_id: claimed.delivery.id,
    event_id: claimed.event.id,
    event_type: claimed.event.type,
  });
  const span = input.tracer?.startSpan("event_worker.delivery", {
    consumer_name: consumerName,
    delivery_id: claimed.delivery.id,
    event_id: claimed.event.id,
    event_type: claimed.event.type,
  });

  try {
    const result = await deliverClaimedEvent({
      claimed,
      db: input.db,
      deliveryProvider: input.deliveryProvider,
      now,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    runs.add(1, { event_type: claimed.event.type, outcome: result.outcome });
    duration.observe(durationMs, { event_type: claimed.event.type, outcome: result.outcome });
    wideEvent.finish("success", {
      duration_ms: durationMs,
      outcome: result.outcome,
      reason: result.outcome === "skipped" ? result.reason : undefined,
    });
    await span?.end("ok", {
      duration_ms: durationMs,
      outcome: result.outcome,
      reason: result.outcome === "skipped" ? result.reason : undefined,
    });

    return {
      deliveryId: claimed.delivery.id,
      durationMs,
      eventId: claimed.event.id,
      eventType: claimed.event.type,
      outcome: result.outcome,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await markFailedDelivery({
      db: input.db,
      delivery: claimed.delivery,
      error: message,
      now,
    });
    const outcome = failed.status === "dead" ? "dead" : "failed";
    const durationMs = Math.round(performance.now() - startedAt);

    runs.add(1, { event_type: claimed.event.type, outcome });
    duration.observe(durationMs, { event_type: claimed.event.type, outcome });
    wideEvent.finish("failure", {
      attempts: failed.attempts,
      duration_ms: durationMs,
      error: message,
      outcome,
    });
    await span?.end("error", {
      attempts: failed.attempts,
      duration_ms: durationMs,
      error: message,
      outcome,
    });

    return {
      deliveryId: claimed.delivery.id,
      durationMs,
      error: message,
      eventId: claimed.event.id,
      eventType: claimed.event.type,
      outcome,
    };
  }
}

export async function runEventWorkerLoop(
  input: EventWorkerInput & {
    pollIntervalMs?: number;
    signal?: AbortSignal;
  },
): Promise<void> {
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_EVENT_WORKER_POLL_INTERVAL_MS;

  while (!input.signal?.aborted) {
    const result = await runEventWorkerOnce(input);

    if (result.outcome === "idle") {
      await sleep(pollIntervalMs, input.signal);
    }
  }
}

export function nextEventDeliveryAttemptAt(input: { attempts: number; now: Date }): Date {
  const delayMs: number =
    EVENT_WORKER_RETRY_DELAYS_MS[
      Math.min(input.attempts, EVENT_WORKER_RETRY_DELAYS_MS.length - 1)
    ] ?? 900_000;

  return new Date(input.now.getTime() + delayMs);
}

async function deliverClaimedEvent(input: {
  claimed: ClaimedEventDelivery;
  db: DbClient;
  deliveryProvider: EventDeliveryProvider;
  now: Date;
}): Promise<EventDeliveryProviderResult> {
  const intent = composeMarketNotification({
    event: input.claimed.event,
    market: input.claimed.market,
  });

  if (!intent) {
    await markEventDeliverySkipped({
      db: input.db,
      deliveryId: input.claimed.delivery.id,
      now: input.now,
      reason: "unsupported_event_or_missing_market",
    });
    return {
      outcome: "skipped",
      reason: "unsupported_event_or_missing_market",
    };
  }

  const result = await input.deliveryProvider.deliver(intent);

  if (result.outcome === "skipped") {
    await markEventDeliverySkipped({
      db: input.db,
      deliveryId: input.claimed.delivery.id,
      now: input.now,
      reason: result.reason,
    });
    return result;
  }

  await markEventDeliveryDelivered({
    db: input.db,
    deliveryId: input.claimed.delivery.id,
    now: input.now,
  });

  return result;
}

async function markFailedDelivery(input: {
  db: DbClient;
  delivery: EventDelivery;
  error: string;
  now: Date;
}): Promise<EventDelivery> {
  return markEventDeliveryFailed({
    db: input.db,
    delivery: input.delivery,
    error: input.error,
    maxAttempts: EVENT_WORKER_MAX_ATTEMPTS,
    nextAttemptAt: nextEventDeliveryAttemptAt({
      attempts: input.delivery.attempts,
      now: input.now,
    }),
    now: input.now,
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
