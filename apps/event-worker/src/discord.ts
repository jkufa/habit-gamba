import {
  getDiscordMetadata,
  mergeDiscordMetadata,
  pricesFromMarketMetadata,
  settlementMarketEmbed,
} from "@habit-gamba/discord";
import { schema, type DbClient } from "@habit-gamba/db";
import type { MarketNotificationIntent } from "@habit-gamba/notification";
import { scheduleMarketReminderDeliveries } from "@habit-gamba/reminders";
import { DiscordAPIError, REST, Routes, ThreadAutoArchiveDuration } from "discord.js";
import { eq } from "drizzle-orm";

import type { EventDeliveryProvider, EventDeliveryProviderResult } from "./service";

export type DiscordDeliveryProviderInput = {
  db: DbClient;
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

  const prices = pricesFromMarketMetadata(intent.market.metadata);
  const market = prices ? { ...intent.market, prices } : intent.market;
  const embed = settlementMarketEmbed(market, {
    ...(intent.kind === "market_resolved" ? { outcome: intent.outcome } : {}),
    ...(intent.kind === "market_voided" ? { reason: intent.reason } : {}),
    title: intent.summaryTitle,
  });
  let summaryMessageId = discord.summaryMessageId;

  if (summaryMessageId) {
    const edited = await editMessage(input.rest, discord.threadId, summaryMessageId, {
      embeds: [embed.toJSON()],
    });

    if (!edited) {
      summaryMessageId = undefined;
    }
  }

  if (!summaryMessageId) {
    const summary = await postMessage(input.rest, discord.threadId, {
      embeds: [embed.toJSON()],
    });
    summaryMessageId = summary.id;
    await pinMessage(input.rest, discord.threadId, summaryMessageId).catch(() => undefined);
    await persistSummaryMessageId(input.db, intent.market.id, intent.market.metadata, {
      summaryMessageId,
      threadId: discord.threadId,
    });
  }

  await postMessage(input.rest, discord.threadId, {
    content: intent.content,
    embeds: [embed.toJSON()],
  });

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
    content: intent.content,
    embeds: [embed.toJSON()],
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
      return false;
    }

    throw error;
  }
}

async function postMessage(
  rest: REST,
  channelId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const message = await rest.post(Routes.channelMessages(channelId), { body });

  if (!isMessageWithId(message)) {
    throw new Error("Discord response missing message id");
  }

  return message;
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
