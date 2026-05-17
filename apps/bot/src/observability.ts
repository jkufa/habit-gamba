import {
  createMetricsRegistry,
  createTracer,
  randomTraceId,
  type Logger,
  type MetricsRegistry,
  type Tracer,
} from "@habit-gamba/logger";
import type { Interaction } from "discord.js";

export type BotObservability = {
  interactionDuration: ReturnType<MetricsRegistry["histogram"]>;
  interactions: ReturnType<MetricsRegistry["counter"]>;
  logger: Logger;
  metrics: MetricsRegistry;
  tracer: Tracer;
};

export function createBotObservability(input: {
  env: string;
  logger: Logger;
  otlpEndpoint?: string | undefined;
}): BotObservability {
  const metrics = createMetricsRegistry();

  return {
    interactionDuration: metrics.histogram(
      "habit_gamba_discord_interaction_duration_ms",
      "Discord interaction duration in milliseconds",
    ),
    interactions: metrics.counter(
      "habit_gamba_discord_interactions_total",
      "Discord interactions handled",
    ),
    logger: input.logger,
    metrics,
    tracer: createTracer({
      endpoint: input.otlpEndpoint,
      env: input.env,
      service: "bot",
    }),
  };
}

export async function observeInteraction(
  observability: BotObservability,
  interaction: Interaction,
  handler: () => Promise<void>,
) {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const traceId = randomTraceId();
  const kind = interactionKind(interaction);
  const command = interaction.isChatInputCommand() ? interaction.commandName : undefined;
  const span = observability.tracer.startSpan("discord.interaction", {
    command,
    interaction_kind: kind,
    request_id: requestId,
    trace_id: traceId,
  });
  const logger = observability.logger.child({ request_id: requestId, trace_id: traceId });

  try {
    await handler();
    const durationMs = Math.round(performance.now() - startedAt);

    observability.interactions.add(1, { command, interaction_kind: kind, outcome: "success" });
    observability.interactionDuration.observe(durationMs, {
      command,
      interaction_kind: kind,
      outcome: "success",
    });
    logger.info("discord_interaction", {
      command,
      duration_ms: durationMs,
      interaction_kind: kind,
      outcome: "success",
    });
    await span.end("ok", { duration_ms: durationMs, outcome: "success" });
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    observability.interactions.add(1, { command, interaction_kind: kind, outcome: "failure" });
    observability.interactionDuration.observe(durationMs, {
      command,
      interaction_kind: kind,
      outcome: "failure",
    });
    logger.error("discord_interaction", {
      command,
      duration_ms: durationMs,
      error,
      interaction_kind: kind,
      outcome: "failure",
    });
    await span.end("error", { duration_ms: durationMs, error, outcome: "failure" });
    throw error;
  }
}

export function startBotMetricsServer(input: {
  logger: Logger;
  metrics: MetricsRegistry;
  port: number | undefined;
}) {
  if (input.port === undefined) {
    return null;
  }

  const server = Bun.serve({
    fetch: () =>
      new Response(input.metrics.render(), { headers: { "Content-Type": "text/plain" } }),
    port: input.port,
  });

  input.logger.info("bot_metrics_server_started", {
    host: server.hostname,
    port: server.port,
  });

  return server;
}

function interactionKind(interaction: Interaction): string {
  if (interaction.isAutocomplete()) {
    return "autocomplete";
  }

  if (interaction.isButton()) {
    return "button";
  }

  if (interaction.isChatInputCommand()) {
    return "chat_input_command";
  }

  if (interaction.isModalSubmit()) {
    return "modal_submit";
  }

  return "unknown";
}
