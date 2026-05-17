import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { formatMicro } from "../money";
import { getAccount, getDiscordUser, registerAccount, type DiscordIdentity } from "../service";
import { requireActor } from "./utils";
import type { BotHandlerContext } from "./context";

export async function handleAccount(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "register") {
    const existingUser = await getDiscordUser({
      ...context.services,
      discordUserId: interaction.user.id,
    });

    if (existingUser) {
      const account = await getAccount({
        ...context.services,
        actor: {
          discordUserId: interaction.user.id,
          userId: existingUser.id,
        },
      });
      await interaction.reply({
        content: `You're already registered. Balance: ${formatMicro(account.balance.availableAmountMicro)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await registerAccount({
      ...context.services,
      identity: getIdentity(interaction),
    });
    await interaction.reply({
      content: `Registered. Balance: ${formatMicro(result.balance.availableAmountMicro)}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const actor = await requireActor(context, interaction);
  const account = await getAccount({ ...context.services, actor });
  await interaction.reply({
    content: `Balance: ${formatMicro(account.balance.availableAmountMicro)}`,
    flags: MessageFlags.Ephemeral,
  });
}

function getIdentity(interaction: ChatInputCommandInteraction): DiscordIdentity {
  return {
    displayName:
      interaction.member && "displayName" in interaction.member
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username),
    handle: interaction.user.username,
    userId: interaction.user.id,
  };
}
