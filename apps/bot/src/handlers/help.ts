import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from "discord.js";

import { buildGlossaryEmbed, buildHelpEmbed } from "../help-content";

export async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    embeds: [buildHelpEmbed(interaction.options.getString("topic"), canViewAdminHelp(interaction))],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleGlossary(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    embeds: [buildGlossaryEmbed(interaction.options.getString("term"))],
    flags: MessageFlags.Ephemeral,
  });
}

export function canViewAdminHelp(interaction: {
  memberPermissions?: Pick<
    NonNullable<ChatInputCommandInteraction["memberPermissions"]>,
    "has"
  > | null;
}) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}
