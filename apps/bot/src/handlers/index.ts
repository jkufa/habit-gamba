import type { Interaction } from "discord.js";

import { autocompleteMarkets } from "../service";
import { handleAccount } from "./account";
import { handleMarket, handleMarketButton, handleMarketModal } from "./market";
import { handlePosition } from "./position";
import type { BotHandlerContext } from "./context";

export async function handleInteraction(context: BotHandlerContext, interaction: Interaction) {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);

    if (focused.name !== "market") {
      await interaction.respond([]);
      return;
    }

    const markets = await autocompleteMarkets({
      ...context.services,
      query: String(focused.value),
    });
    await interaction.respond(
      markets.map((market) => ({
        name: `${market.title.slice(0, 80)} (${market.slug})`,
        value: market.id,
      })),
    );
    return;
  }

  if (interaction.isButton()) {
    await handleMarketButton(context, interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleMarketModal(context, interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "account") {
    await handleAccount(context, interaction);
    return;
  }

  if (interaction.commandName === "position") {
    await handlePosition(context, interaction);
    return;
  }

  if (interaction.commandName === "market") {
    await handleMarket(context, interaction);
  }
}
