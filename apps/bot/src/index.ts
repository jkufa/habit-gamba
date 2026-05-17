import { loadBotRuntimeEnv } from "@habit-gamba/env";
import { Client, Events, GatewayIntentBits } from "discord.js";

import { handleInteraction } from "./handlers";
import { replyError } from "./handlers/utils";
import type { BotServices } from "./service";

const env = loadBotRuntimeEnv();
const services: BotServices = {
  apiBaseUrl: env.API_BASE_URL,
  botApiToken: env.BOT_API_TOKEN,
};
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let shuttingDown = false;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`discord bot online user=${readyClient.user.tag} logLevel=${env.LOG_LEVEL}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction({ client, services }, interaction);
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
  console.log(`discord bot shutting down signal=${signal}`);
  client.destroy();
  process.exit(0);
}
