import type { MarketReminderDeliveryProvider } from "./service";
import { REST, Routes } from "discord.js";

export function createDiscordRest(token: string): REST {
  return new REST({ version: "10" }).setToken(token);
}

export function createDiscordReminderDeliveryProvider(input: {
  rest: REST;
}): MarketReminderDeliveryProvider {
  return {
    deliver: async (intent) => {
      const message = await input.rest.post(Routes.channelMessages(intent.threadId), {
        body: {
          content: intent.content,
        },
      });

      if (!isMessageWithId(message)) {
        throw new Error("Discord response missing message id");
      }

      return {
        discordMessageId: message.id,
        outcome: "delivered",
      };
    },
  };
}

function isMessageWithId(value: unknown): value is { id: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}
