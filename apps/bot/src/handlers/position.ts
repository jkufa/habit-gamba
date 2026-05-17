import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { formatMicro } from "../money";
import { listPositionsCommand } from "../service";
import { requireActor } from "./utils";
import type { BotHandlerContext } from "./context";

export async function handlePosition(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const actor = await requireActor(context, interaction);
  const result = await listPositionsCommand({ ...context.services, actor });

  if (result.positions.length === 0) {
    await interaction.reply({ content: "No open positions.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Positions")
        .setDescription(
          result.positions
            .map(
              (item) =>
                `**${item.market.title}** ${item.contract.outcome}: ${formatMicro(item.position.quantityMicro, "contracts")}`,
            )
            .join("\n"),
        ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
