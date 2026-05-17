import { loadBotEnv } from "@habit-gamba/env";
import { REST, Routes } from "discord.js";

import { commandData } from "./commands";

const env = loadBotEnv();
const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
const deployGlobal = process.argv.includes("--global");

if (deployGlobal) {
  await rest.put(Routes.applicationCommands(env.DISCORD_APPLICATION_ID), { body: commandData });
  console.log(`registered ${commandData.length} global commands`);
} else {
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_DEV_GUILD_ID),
    { body: commandData },
  );
  console.log(
    `registered ${commandData.length} dev guild commands guild=${env.DISCORD_DEV_GUILD_ID}`,
  );
}
