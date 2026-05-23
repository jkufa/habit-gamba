import { getDiscordMetadata } from "@habit-gamba/discord";
import type { DbClient } from "@habit-gamba/db";
import { createLogger, createMetricsRegistry, createWideEvent } from "@habit-gamba/logger";
import type { Logger, MetricsRegistry, Tracer } from "@habit-gamba/logger";
import {
  claimMarketReminderDelivery,
  markMarketReminderDelivered,
  markMarketReminderFailed,
  markMarketReminderSkipped,
  nextMarketReminderAttemptAt,
  normalizeMarketReminderBatchLimit,
  MARKET_REMINDER_MAX_ATTEMPTS,
  type ClaimedMarketReminderDelivery,
  type MarketReminderDelivery,
} from "@habit-gamba/reminders";

export type MarketReminderDeliveryProvider = {
  deliver: (input: MarketReminderDeliveryIntent) => Promise<MarketReminderDeliveryProviderResult>;
};
export type MarketReminderDeliveryIntent = {
  content: string;
  delivery: MarketReminderDelivery;
  market: ClaimedMarketReminderDelivery["market"];
  threadId: string;
};
export type MarketReminderDeliveryProviderResult =
  | {
      discordMessageId: string;
      outcome: "delivered";
    }
  | {
      outcome: "skipped";
      reason: string;
    };
export type MarketReminderWorkerInput = {
  db: DbClient;
  deliveryProvider: MarketReminderDeliveryProvider;
  env: string;
  limit?: number;
  lockTtlMs?: number;
  logger?: Logger;
  metrics?: MetricsRegistry;
  now?: Date;
  tracer?: Tracer;
};
export type MarketReminderWorkerResult = {
  deadCount: number;
  deliveredCount: number;
  durationMs: number;
  failedCount: number;
  idleCount: number;
  outcome: "failure" | "success";
  processedCount: number;
  skippedCount: number;
};

export async function runMarketReminderWorker(
  input: MarketReminderWorkerInput,
): Promise<MarketReminderWorkerResult> {
  const logger =
    input.logger ??
    createLogger({
      env: input.env,
      service: "market-reminder-worker",
    });
  const metrics = input.metrics ?? createMetricsRegistry();
  const limit = normalizeMarketReminderBatchLimit(input.limit);
  const runs = metrics.counter("habit_gamba_market_reminder_worker_runs_total", "Worker runs");
  const deliveries = metrics.counter(
    "habit_gamba_market_reminder_worker_deliveries_total",
    "Reminder deliveries",
  );
  const duration = metrics.histogram(
    "habit_gamba_market_reminder_worker_duration_ms",
    "Worker run duration in milliseconds",
  );
  const wideEvent = createWideEvent(logger, "market_reminder_worker.run", { limit });
  const span = input.tracer?.startSpan("market_reminder_worker.run", { limit });
  const startedAt = performance.now();
  const now = input.now ?? new Date();
  const counts = {
    deadCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    idleCount: 0,
    skippedCount: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const result = await runMarketReminderDeliveryOnce({
      ...input,
      logger,
      metrics,
      now,
    });

    if (result.outcome === "idle") {
      counts.idleCount += 1;
      break;
    }

    deliveries.add(1, { outcome: result.outcome });

    if (result.outcome === "dead") {
      counts.deadCount += 1;
    } else if (result.outcome === "delivered") {
      counts.deliveredCount += 1;
    } else if (result.outcome === "failed") {
      counts.failedCount += 1;
    } else if (result.outcome === "skipped") {
      counts.skippedCount += 1;
    }
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const outcome = counts.failedCount > 0 || counts.deadCount > 0 ? "failure" : "success";
  const processedCount =
    counts.deadCount + counts.deliveredCount + counts.failedCount + counts.skippedCount;

  runs.add(1, { outcome });
  duration.observe(durationMs, { outcome });
  wideEvent.finish(outcome, {
    ...counts,
    duration_ms: durationMs,
    processed_count: processedCount,
  });
  await span?.end(outcome === "success" ? "ok" : "error", {
    ...counts,
    duration_ms: durationMs,
    outcome,
    processed_count: processedCount,
  });

  return {
    ...counts,
    durationMs,
    outcome,
    processedCount,
  };
}

export async function runMarketReminderDeliveryOnce(input: MarketReminderWorkerInput): Promise<{
  deliveryId?: string;
  error?: string;
  marketId?: string;
  outcome: "dead" | "delivered" | "failed" | "idle" | "skipped";
  reason?: string;
}> {
  const now = input.now ?? new Date();
  const claimed = await claimMarketReminderDelivery({
    db: input.db,
    now,
    ...(input.lockTtlMs === undefined ? {} : { lockTtlMs: input.lockTtlMs }),
  });

  if (!claimed) {
    return { outcome: "idle" };
  }

  try {
    const result = await deliverClaimedReminder({
      claimed,
      db: input.db,
      deliveryProvider: input.deliveryProvider,
      now,
    });

    return {
      deliveryId: claimed.delivery.id,
      marketId: claimed.market.id,
      outcome: result.outcome,
      ...(result.outcome === "skipped" ? { reason: result.reason } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextAttemptAt = nextMarketReminderAttemptAt({
      attempts: claimed.delivery.attempts,
      now,
    });

    if (claimed.market.closesAt && nextAttemptAt >= claimed.market.closesAt) {
      await markMarketReminderSkipped({
        db: input.db,
        deliveryId: claimed.delivery.id,
        now,
        reason: `retry_window_elapsed:${message}`,
      });

      return {
        deliveryId: claimed.delivery.id,
        error: message,
        marketId: claimed.market.id,
        outcome: "skipped",
        reason: "retry_window_elapsed",
      };
    }

    const failed = await markMarketReminderFailed({
      db: input.db,
      delivery: claimed.delivery,
      error: message,
      maxAttempts: MARKET_REMINDER_MAX_ATTEMPTS,
      nextAttemptAt,
      now,
    });

    return {
      deliveryId: claimed.delivery.id,
      error: message,
      marketId: claimed.market.id,
      outcome: failed.status === "dead" ? "dead" : "failed",
    };
  }
}

async function deliverClaimedReminder(input: {
  claimed: ClaimedMarketReminderDelivery;
  db: DbClient;
  deliveryProvider: MarketReminderDeliveryProvider;
  now: Date;
}): Promise<MarketReminderDeliveryProviderResult> {
  const skipReason = validateClaimedReminder(input.claimed, input.now);

  if (skipReason) {
    await markMarketReminderSkipped({
      db: input.db,
      deliveryId: input.claimed.delivery.id,
      now: input.now,
      reason: skipReason,
    });

    return { outcome: "skipped", reason: skipReason };
  }

  const threadId = getDiscordMetadata(input.claimed.market.metadata).threadId;
  const providerUserId = input.claimed.recipient.providerUserId;

  if (!threadId) {
    throw new Error("Validated reminder missing Discord thread id");
  }

  const result = await input.deliveryProvider.deliver({
    content: `<@${providerUserId}> reminder: "${input.claimed.market.title}" closes at 11:59:59pm ET today. Add proof or resolve before then.`,
    delivery: input.claimed.delivery,
    market: input.claimed.market,
    threadId,
  });

  if (result.outcome === "skipped") {
    await markMarketReminderSkipped({
      db: input.db,
      deliveryId: input.claimed.delivery.id,
      now: input.now,
      reason: result.reason,
    });

    return result;
  }

  await markMarketReminderDelivered({
    db: input.db,
    deliveryId: input.claimed.delivery.id,
    discordMessageId: result.discordMessageId,
    now: input.now,
  });

  return result;
}

function validateClaimedReminder(claimed: ClaimedMarketReminderDelivery, now: Date): string | null {
  if (claimed.market.status !== "open") {
    return "market_not_open";
  }

  if (!claimed.market.closesAt || now >= claimed.market.closesAt) {
    return "market_closed";
  }

  if (!getDiscordMetadata(claimed.market.metadata).threadId) {
    return "missing_discord_thread_id";
  }

  if (claimed.recipient.status !== "active") {
    return "recipient_not_active";
  }

  if (claimed.recipient.provider !== "discord" || claimed.recipient.providerUserId.length === 0) {
    return "recipient_not_discord";
  }

  return null;
}
