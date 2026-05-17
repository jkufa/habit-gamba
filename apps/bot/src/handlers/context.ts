import type { Client } from "discord.js";

import type { BotServices } from "../service";

export type BotHandlerContext = {
  client: Client;
  services: BotServices;
};
