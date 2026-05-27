import {
  getDiscordMetadata,
  mergeDiscordMetadata,
  pricesFromMarketMetadata,
  settlementMarketEmbed,
} from "@habit-gamba/discord";
import { schema, type DbClient } from "@habit-gamba/db";
import type { Logger } from "@habit-gamba/logger";
import type { MarketNotificationIntent } from "@habit-gamba/notification";
import { scheduleMarketReminderDeliveries } from "@habit-gamba/reminders";
import {
  DiscordAPIError,
  escapeMarkdown,
  REST,
  Routes,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { eq } from "drizzle-orm";

import type { EventDeliveryProvider, EventDeliveryProviderResult } from "./service";

export type DiscordDeliveryProviderInput = {
  db: DbClient;
  logger?: Logger;
  rest: REST;
};

export function createDiscordDeliveryProvider(
  input: DiscordDeliveryProviderInput,
): EventDeliveryProvider {
  return {
    deliver: (intent) => deliverDiscordMarketNotification(input, intent),
  };
}

export function createDiscordRest(token: string): REST {
  return new REST({ version: "10" }).setToken(token);
}

async function deliverDiscordMarketNotification(
  input: DiscordDeliveryProviderInput,
  intent: MarketNotificationIntent,
): Promise<EventDeliveryProviderResult> {
  const discord = getDiscordMetadata(intent.market.metadata);

  if (intent.kind === "market_opened") {
    return deliverDiscordMarketOpenedNotification(input, intent, discord);
  }

  if (!discord.threadId) {
    return {
      outcome: "skipped",
      reason: "missing_discord_thread_id",
    };
  }

  const threadId = discord.threadId;
  const prices = pricesFromMarketMetadata(intent.market.metadata);
  const market = prices ? { ...intent.market, prices } : intent.market;
  const embed = settlementMarketEmbed(market, {
    ...(intent.kind === "market_resolved" ? { outcome: intent.outcome } : {}),
    ...(intent.kind === "market_voided" ? { reason: intent.reason } : {}),
    title: intent.summaryTitle,
  });

  try {
    await updateOrCreateSummary(input, intent, threadId, embed.toJSON());
    await tryDiscordTerminalStep(input, intent, threadId, "post_terminal_message", () =>
      postMessage(input.rest, threadId, {
        content: intent.content,
        embeds: [embed.toJSON()],
      }),
    );
    await tryDiscordTerminalStep(input, intent, threadId, "close_thread", () =>
      closeThread(input.rest, threadId),
    );
  } catch (error) {
    if (error instanceof DiscordThreadNotFoundError) {
      return {
        outcome: "skipped",
        reason: "discord_thread_not_found",
      };
    }

    throw error;
  }

  return {
    outcome: "delivered",
  };
}

async function deliverDiscordMarketOpenedNotification(
  input: DiscordDeliveryProviderInput,
  intent: Extract<MarketNotificationIntent, { kind: "market_opened" }>,
  discord: ReturnType<typeof getDiscordMetadata>,
): Promise<EventDeliveryProviderResult> {
  if (discord.threadId) {
    return { outcome: "delivered" };
  }

  if (!discord.channelId) {
    return {
      outcome: "skipped",
      reason: "missing_discord_channel_id",
    };
  }

  const embed = settlementMarketEmbed(intent.market, {
    title: intent.summaryTitle,
  });
  const parentMessage = await postMessage(input.rest, discord.channelId, {
    content: `Market opened: **${escapeMarkdown(intent.market.title)}**`,
  });
  const thread = await startThreadFromMessage(input.rest, discord.channelId, parentMessage.id, {
    name: intent.market.title.slice(0, 90),
  });
  const summary = await postMessage(input.rest, thread.id, {
    embeds: [embed.toJSON()],
  });

  await pinMessage(input.rest, thread.id, summary.id).catch(() => undefined);
  await persistSummaryMessageId(input.db, intent.market.id, intent.market.metadata, {
    channelId: discord.channelId,
    ...(discord.guildId ? { guildId: discord.guildId } : {}),
    summaryMessageId: summary.id,
    threadId: thread.id,
  });

  return {
    outcome: "delivered",
  };
}

async function editMessage(
  rest: REST,
  channelId: string,
  messageId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    await rest.patch(Routes.channelMessage(channelId, messageId), { body });
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError && error.status === 404) {
      if (isDiscordUnknownChannel(error)) {
        throw new DiscordThreadNotFoundError(channelId);
      }

      return false;
    }

    throw error;
  }
}

async function updateOrCreateSummary(
  input: DiscordDeliveryProviderInput,
  intent: MarketNotificationIntent,
  threadId: string,
  embed: unknown,
): Promise<void> {
  await tryDiscordTerminalStep(input, intent, threadId, "update_summary", async () => {
    let summaryMessageId = getDiscordMetadata(intent.market.metadata).summaryMessageId;

    if (summaryMessageId) {
      const edited = await editMessage(input.rest, threadId, summaryMessageId, {
        embeds: [embed],
      });

      if (!edited) {
        summaryMessageId = undefined;
      }
    }

    if (!summaryMessageId) {
      const summary = await postMessage(input.rest, threadId, {
        embeds: [embed],
      });
      summaryMessageId = summary.id;
      await pinMessage(input.rest, threadId, summaryMessageId).catch(() => undefined);
      await persistSummaryMessageId(input.db, intent.market.id, intent.market.metadata, {
        summaryMessageId,
        threadId,
      });
    }
  });
}

async function postMessage(
  rest: REST,
  channelId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const message = await tryDiscordThreadRequest(channelId, () =>
    rest.post(Routes.channelMessages(channelId), { body }),
  );

  if (!isMessageWithId(message)) {
    throw new Error("Discord response missing message id");
  }

  return message;
}

async function closeThread(rest: REST, threadId: string): Promise<void> {
  await tryDiscordThreadRequest(threadId, () =>
    rest.patch(Routes.channel(threadId), {
      body: {
        archived: true,
        locked: true,
      },
      reason: "Habit Gamba terminal market thread",
    }),
  );
}

async function tryDiscordTerminalStep(
  input: DiscordDeliveryProviderInput,
  intent: MarketNotificationIntent,
  threadId: string,
  step: "close_thread" | "post_terminal_message" | "update_summary",
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DiscordThreadNotFoundError) {
      throw error;
    }

    input.logger?.error("discord_terminal_market_step_failed", {
      error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
      event_type: intent.eventType,
      market_id: intent.market.id,
      step,
      thread_id: threadId,
    });
  }
}

async function tryDiscordThreadRequest<T>(threadId: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      error.status === 404 &&
      isDiscordUnknownChannel(error)
    ) {
      throw new DiscordThreadNotFoundError(threadId);
    }

    throw error;
  }
}

async function startThreadFromMessage(
  rest: REST,
  channelId: string,
  messageId: string,
  input: { name: string },
): Promise<{ id: string }> {
  const thread = await rest.post(Routes.threads(channelId, messageId), {
    body: {
      auto_archive_duration: ThreadAutoArchiveDuration.OneWeek,
      name: input.name,
    },
    reason: "Habit Gamba recurring market thread",
  });

  if (!isMessageWithId(thread)) {
    throw new Error("Discord response missing thread id");
  }

  return thread;
}

async function pinMessage(rest: REST, channelId: string, messageId: string): Promise<void> {
  await rest.put(Routes.channelPin(channelId, messageId));
}

async function persistSummaryMessageId(
  db: DbClient,
  marketId: string,
  metadata: Record<string, unknown>,
  discordPatch: Record<string, unknown>,
): Promise<void> {
  const [market] = await db
    .update(schema.markets)
    .set({
      metadata: mergeDiscordMetadata(metadata, discordPatch),
      updatedAt: new Date(),
    })
    .where(eq(schema.markets.id, marketId))
    .returning();

  if (market) {
    await scheduleMarketReminderDeliveries({ db, market });
  }
}

function isMessageWithId(value: unknown): value is { id: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

function isDiscordUnknownChannel(error: DiscordAPIError): boolean {
  return Number((error as { code?: unknown }).code) === 10003;
}

class DiscordThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Discord thread not found: ${threadId}`);
    this.name = "DiscordThreadNotFoundError";
  }
}
