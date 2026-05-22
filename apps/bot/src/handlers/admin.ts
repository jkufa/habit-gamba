import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { formatMicro, parseDecimalMicro } from "../money";
import { adjustUserBalanceCommand, getDiscordUser } from "../service";
import { requireActor, requireValue } from "./utils";
import type { BotHandlerContext } from "./context";

export async function handleAdmin(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand !== "credit" && subcommand !== "debit") {
    throw new RangeError("Unknown admin command");
  }

  const actor = await requireActor(context, interaction);
  const targetDiscordUser = interaction.options.getUser("user", true);
  const targetUser = await getDiscordUser({
    ...context.services,
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
