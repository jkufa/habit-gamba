import { loadBotRuntimeEnv } from "@habit-gamba/env";
import { createLogger } from "@habit-gamba/logger";
import { Client, Events, GatewayIntentBits } from "discord.js";

import { handleInteraction } from "./handlers";
import { replyError } from "./handlers/utils";
import { createBotObservability, observeInteraction, startBotMetricsServer } from "./observability";
import type { BotServices } from "./service";

const env = loadBotRuntimeEnv();
const logger = createLogger({
  env: env.NODE_ENV,
  level: env.LOG_LEVEL,
  service: "bot",
});
const observability = createBotObservability({
  env: env.NODE_ENV,
  logger,
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
const services: BotServices = {
  apiBaseUrl: env.API_BASE_URL,
  botApiToken: env.BOT_API_TOKEN,
  logger,
};
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const metricsServer = startBotMetricsServer({
  logger,
  metrics: observability.metrics,
  port: env.BOT_METRICS_PORT,
});
let shuttingDown = false;

client.once(Events.ClientReady, (readyClient) => {
  logger.info("discord_bot_online", {
    log_level: env.LOG_LEVEL,
    user_id: readyClient.user.id,
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await observeInteraction(observability, interaction, () =>
      handleInteraction({ client, services }, interaction),
    );
  } catch (error) {
    await replyError(interaction, error);
  }
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(env.DISCORD_BOT_TOKEN);

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("discord_bot_shutdown", { signal });
  metricsServer?.stop();
  client.destroy();
  process.exit(0);
}
