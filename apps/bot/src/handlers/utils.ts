import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
  type ThreadChannel,
} from "discord.js";

import { autocompleteMarkets, getDiscordUser, marketSummaryFields } from "../service";
import { isGuildAdminPermission, type Actor } from "../permissions";
import type { BotHandlerContext } from "./context";

export type RepliableBotInteraction =
  | ButtonInteraction
  | ChatInputCommandInteraction
  | ModalSubmitInteraction;

export async function requireActor(
  context: BotHandlerContext,
  interaction: RepliableBotInteraction,
): Promise<Actor> {
  const user = await getDiscordUser({
    ...context.services,
    discordUserId: interaction.user.id,
  });

  if (!user) {
    throw new Error("Register first with `/account register`");
  }

  return {
    discordUserId: interaction.user.id,
    isGuildAdmin: isGuildAdminPermission(interaction.memberPermissions?.bitfield),
    userId: user.id,
  };
}

export async function resolveMarketId(context: BotHandlerContext, value: string) {
  const matches = await autocompleteMarkets({ ...context.services, query: value });
  const exact = matches.find((market) => market.id === value || market.slug === value);

  return (exact ?? matches[0])?.id ?? value;
}

export async function ensureMarketThread(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  market: { id: string; metadata: Record<string, unknown>; title: string },
) {
  const existingThreadId = getDiscordMetadata(market.metadata).threadId;

  if (existingThreadId) {
    const channel = await context.client.channels.fetch(String(existingThreadId));
    return channel?.isThread() ? channel : null;
  }

  const threadManager = getThreadManager(interaction.channel);

  if (!threadManager) {
    return null;
  }

  const thread = await threadManager.create({
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    name: market.title.slice(0, 90),
    reason: "Habit Gamba market thread",
  });

  return thread;
}

export function marketEmbed(
  market: {
    closesAt: Date | null;
    description?: string | null;
    id: string;
    prices?: { no: number; yes: number };
    slug: string;
    status: string;
    title: string;
  },
  title: string,
) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`**${market.title}**${market.description ? `\n${market.description}` : ""}`)
    .addFields(...marketSummaryFields(market))
    .setFooter({ text: `market ${market.id}` });
}

export function modal(customId: string, title: string, inputs: TextInputBuilder[]): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      ...inputs.map((input) => new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
    );
}

export function textInput(
  customId: string,
  label: string,
  style: Parameters<TextInputBuilder["setStyle"]>[0],
  required: boolean,
  value?: string,
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setRequired(required)
    .setStyle(style);

  if (value) {
    input.setValue(value);
  }

  return input;
}

export function field(interaction: ModalSubmitInteraction, customId: string) {
  return interaction.fields.getTextInputValue(customId).trim() || null;
}

export function requiredField(interaction: ModalSubmitInteraction, customId: string) {
  return requireValue(field(interaction, customId), customId);
}

export function parseBoolean(value: string | null) {
  return ["yes", "true", "1", "y", "open"].includes(value?.trim().toLowerCase() ?? "");
}

export function parseDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new RangeError("Date must be valid ISO date/time");
  }

  return date;
}

export function parseMode(value: string) {
  if (value === "spend_rep" || value === "target_shares") {
    return value;
  }

  throw new RangeError("mode must be spend_rep or target_shares");
}

export function parseOutcome(value: string) {
  const normalized = value.trim().toUpperCase();

  if (normalized === "YES" || normalized === "NO") {
    return normalized;
  }

  throw new RangeError("outcome must be YES or NO");
}

export function requireValue(value: string | null, label: string) {
  if (!value?.trim()) {
    throw new RangeError(`${label} is required`);
  }

  return value.trim();
}

export function getDiscordMetadata(metadata: Record<string, unknown>) {
  const discord = metadata.discord;
  return discord && typeof discord === "object" && !Array.isArray(discord)
    ? (discord as Record<string, unknown>)
    : {};
}

export async function replyError(interaction: Interaction, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("discord interaction error", error);

  if (interaction.isRepliable()) {
    const payload = {
      content: message,
      flags: MessageFlags.Ephemeral,
    } satisfies InteractionReplyOptions;

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
}

function getThreadManager(channel: unknown): {
  create: (options: {
    autoArchiveDuration: ThreadAutoArchiveDuration;
    name: string;
    reason: string;
  }) => Promise<ThreadChannel>;
} | null {
  if (channel && typeof channel === "object" && "threads" in channel) {
    return (
      channel as {
        threads: {
          create: (options: {
            autoArchiveDuration: ThreadAutoArchiveDuration;
            name: string;
            reason: string;
          }) => Promise<ThreadChannel>;
        };
      }
    ).threads;
  }

  return null;
}
