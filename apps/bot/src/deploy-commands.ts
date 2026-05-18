import { botEnvSchema, loadBotEnv, requireDiscordDevGuildId } from "@habit-gamba/env";
import { REST, Routes } from "discord.js";

import { commandData } from "./commands";

const deployGlobal = process.argv.includes("--global");
const env = deployGlobal ? botEnvSchema.parse(process.env) : loadBotEnv();
const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

if (deployGlobal) {
  await rest.put(Routes.applicationCommands(env.DISCORD_APPLICATION_ID), { body: commandData });
  console.log(`registered ${commandData.length} global commands`);
} else {
  const devGuildId = requireDiscordDevGuildId(env);

  await rest.put(Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, devGuildId), {
    body: commandData,
  });
  console.log(`registered ${commandData.length} dev guild commands guild=${devGuildId}`);
}
