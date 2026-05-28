import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { formatMicro, parseDecimalMicro } from "../money";
import { adjustUserBalanceCommand, closeMarketCommand, getDiscordUser } from "../service";
import {
  marketEmbed,
  requireActor,
  requireDiscordCommunity,
  requireValue,
  resolveMarketId,
} from "./utils";
import type { BotHandlerContext } from "./context";

export async function handleAdmin(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (group === "market") {
    await handleAdminMarket(context, interaction, subcommand);
    return;
  }

  if (subcommand !== "credit" && subcommand !== "debit") {
    throw new RangeError("Unknown admin command");
  }

  const actor = await requireActor(context, interaction);
  const targetDiscordUser = interaction.options.getUser("user", true);
  const targetUser = await getDiscordUser({
    ...context.services,
    community: requireDiscordCommunity(interaction),
    discordUserId: targetDiscordUser.id,
  });

  if (!targetUser) {
    throw new Error("Target user must register first with `/account register`");
  }

  const amountMicro = parseDecimalMicro(
    requireValue(interaction.options.getString("amount", true), "amount"),
    "amount",
  );
  const reason = requireValue(interaction.options.getString("reason", true), "reason");
  const result = await adjustUserBalanceCommand({
    ...context.services,
    actor,
    amountMicro,
    direction: subcommand,
    reason,
    targetUserId: targetUser.id,
  });

  await interaction.reply({
    content: [
      `${subcommand === "credit" ? "Credited" : "Debited"} ${formatMicro(amountMicro)} ${subcommand === "credit" ? "to" : "from"} ${targetDiscordUser}.`,
      `New balance: ${formatMicro(result.balance.availableAmountMicro)}`,
      `Reason: ${reason}`,
    ].join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminMarket(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
  subcommand: string,
) {
  if (subcommand !== "close") {
    throw new RangeError("Unknown admin market command");
  }

  const actor = await requireActor(context, interaction);
  const marketId = requireValue(interaction.options.getString("market", true), "market");
  const market = await closeMarketCommand({
    ...context.services,
    actor,
    marketId: await resolveMarketId(context, interaction, marketId),
  });

  await interaction.reply({
    embeds: [marketEmbed(market, "Market closed")],
    flags: MessageFlags.Ephemeral,
  });
}
