import {
  getDiscordMetadata,
  mergeDiscordMetadata,
  pricesFromMarketMetadata,
  settlementMarketEmbed,
} from "@habit-gamba/discord";
import { schema, type DbClient } from "@habit-gamba/db";
import type { MarketNotificationIntent } from "@habit-gamba/notification";
import { DiscordAPIError, REST, Routes } from "discord.js";
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

async function pinMessage(rest: REST, channelId: string, messageId: string): Promise<void> {
  await rest.put(Routes.channelPin(channelId, messageId));
}

async function persistSummaryMessageId(
  db: DbClient,
  marketId: string,
  metadata: Record<string, unknown>,
  discordPatch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(schema.markets)
    .set({
      metadata: mergeDiscordMetadata(metadata, discordPatch),
      updatedAt: new Date(),
    })
    .where(eq(schema.markets.id, marketId));
}

function isMessageWithId(value: unknown): value is { id: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}
