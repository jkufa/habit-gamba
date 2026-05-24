import {
  ActionRowBuilder,
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

import { getDiscordMetadata, marketEmbed } from "@habit-gamba/discord";

import { APP_CONFIG } from "../app-config";
import {
  autocompleteMarkets,
  BotApiError,
  findMarketByDiscordThread,
  getDiscordUser,
} from "../service";
import type { Actor } from "../permissions";
import type { BotHandlerContext } from "./context";

export { getDiscordMetadata, marketEmbed };

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
    userId: user.id,
  };
}

export async function resolveMarketId(context: BotHandlerContext, value: string) {
  const matches = await autocompleteMarkets({ ...context.services, query: value });
  const exact = matches.find((market) => market.id === value || market.slug === value);

  return (exact ?? matches[0])?.id ?? value;
}

export async function resolveDefaultMarketValue(
  context: BotHandlerContext,
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
  explicitValue?: string | null,
): Promise<string | null> {
  const trimmed = explicitValue?.trim();

  if (trimmed) {
    return trimmed;
  }

  if (!interaction.channel?.isThread()) {
    return null;
  }

  const market = await findMarketByDiscordThread({
    ...context.services,
    threadId: interaction.channel.id,
  });

  return market?.id ?? null;
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
    reason: `${APP_CONFIG.name} market thread`,
  });

  return thread;
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

export function parseCloseDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());

  if (!match) {
    throw new RangeError("Close date must use MM/DD/YYYY. Markets close at 11:59:59pm ET.");
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError("Close date must be a real date in MM/DD/YYYY format.");
  }

  return zonedTimeToUtc(year, month, day, 23, 59, 59, "America/New_York");
}

export function parseEasternDateKey(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());

  if (!match) {
    throw new RangeError("Date must use MM/DD/YYYY.");
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new RangeError("Date must be a real date in MM/DD/YYYY format.");
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatTodayEasternDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.month}/${values.day}/${values.year}`;
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

export async function replyError(interaction: Interaction, error: unknown) {
  const message = userFacingErrorMessage(error);

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

export function userFacingErrorMessage(error: unknown) {
  if (error instanceof BotApiError && error.code === "MARKET_NOT_TRADEABLE") {
    const details = error.details as {
      closesAt?: string | null;
      now?: string;
      status?: string;
    };

    if (details.status === "draft") {
      return "This market is not open yet.";
    }

    if (details.status === "closed") {
      return "This market is closed.";
    }

    if (details.status === "resolved") {
      return "This market is already resolved.";
    }

    if (details.status === "void") {
      return "This market was cancelled.";
    }

    if (
      details.status === "open" &&
      details.closesAt &&
      details.now &&
      new Date(details.now) >= new Date(details.closesAt)
    ) {
      return "This market is past its close time.";
    }
  }

  return error instanceof Error ? error.message : String(error);
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

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offset);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return zonedAsUtc - date.getTime();
}
