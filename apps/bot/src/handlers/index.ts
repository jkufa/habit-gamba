import type { Interaction } from "discord.js";

import { autocompleteMarkets, getDiscordUser } from "../service";
import { handleAdmin } from "./admin";
import { handleAccount } from "./account";
import { canViewAdminHelp, handleGlossary, handleHelp } from "./help";
import { handleLeaderboard } from "./leaderboard";
import { handleMarket, handleMarketButton, handleMarketModal } from "./market";
import { handlePosition } from "./position";
import { glossaryTermChoices, helpTopicChoices } from "../help-content";
import type { BotHandlerContext } from "./context";

export async function handleInteraction(context: BotHandlerContext, interaction: Interaction) {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);

    if (interaction.commandName === "help" && focused.name === "topic") {
      await interaction.respond(
        helpTopicChoices(String(focused.value), canViewAdminHelp(interaction)),
      );
      return;
    }

    if (interaction.commandName === "glossary" && focused.name === "term") {
      await interaction.respond(glossaryTermChoices(String(focused.value)));
      return;
    }

    if (focused.name !== "market") {
      await interaction.respond([]);
      return;
    }

    const user = await getDiscordUser({
      ...context.services,
      discordUserId: interaction.user.id,
    });
    const actor = user
      ? {
          discordUserId: interaction.user.id,
          userId: user.id,
        }
      : undefined;
    const subcommand = interaction.options.getSubcommand(false);
    const autocompleteInput = {
      ...context.services,
      query: String(focused.value),
      ...(actor ? { actor } : {}),
      ...(subcommand ? { subcommand } : {}),
    };
    const markets = await autocompleteMarkets(autocompleteInput);
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

  if (interaction.commandName === "admin") {
    await handleAdmin(context, interaction);
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

  if (interaction.commandName === "leaderboard") {
    await handleLeaderboard(context, interaction);
    return;
  }

  if (interaction.commandName === "help") {
    await handleHelp(interaction);
    return;
  }

  if (interaction.commandName === "glossary") {
    await handleGlossary(interaction);
    return;
  }

  if (interaction.commandName === "market") {
    await handleMarket(context, interaction);
  }
}
