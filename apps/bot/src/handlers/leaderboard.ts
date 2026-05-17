import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";

import { REP_SCALE } from "@habit-gamba/db";

import { getLeaderboardCommand, type BotLeaderboardEntry } from "../service";
import type { BotHandlerContext } from "./context";

const DEFAULT_LEADERBOARD_LIMIT = 10;
const MAX_LEADERBOARD_LIMIT = 25;
const MAX_LEADERBOARD_NAME_LENGTH = 18;

export async function handleLeaderboard(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction,
) {
  const limit = normalizeLeaderboardLimit(interaction.options.getInteger("limit"));
  const isPrivate = interaction.options.getBoolean("private") ?? false;
  const result = await getLeaderboardCommand({ ...context.services, limit });

  if (result.entries.length === 0) {
    await interaction.reply({
      content: "No leaderboard entries yet.",
      flags: isPrivate ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Global REP Leaderboard")
        .setDescription(formatLeaderboardRows(result.entries)),
    ],
    flags: isPrivate ? MessageFlags.Ephemeral : undefined,
  });
}

export function formatLeaderboardRows(entries: BotLeaderboardEntry[]): string {
  const rows = entries.map((entry) => ({
    amount: formatLeaderboardRep(entry.balance.availableAmountMicro),
    name: truncateName(entry.user.displayName),
    rank: `#${entry.rank}`,
  }));
  const rankWidth = Math.max(...rows.map((row) => row.rank.length));
  const nameWidth = Math.max(...rows.map((row) => row.name.length));
  const amountWidth = Math.max(...rows.map((row) => row.amount.length));
  const table = rows
    .map(
      (row) =>
        `${row.rank.padEnd(rankWidth)}  ${row.name.padEnd(nameWidth)}  ${row.amount.padStart(amountWidth)}`,
    )
    .join("\n");

  return `\`\`\`text\n${table}\n\`\`\``;
}

export function normalizeLeaderboardLimit(limit: number | null): number {
  if (limit === null) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LEADERBOARD_LIMIT);
}

function formatLeaderboardRep(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / REP_SCALE;
  const cents = (absolute % REP_SCALE) / (REP_SCALE / 100n);

  return `${sign}${addThousandsSeparators(whole.toString())}.${cents.toString().padStart(2, "0")} REP`;
}

function addThousandsSeparators(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function truncateName(value: string): string {
  if (value.length <= MAX_LEADERBOARD_NAME_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_LEADERBOARD_NAME_LENGTH - 3)}...`;
}
