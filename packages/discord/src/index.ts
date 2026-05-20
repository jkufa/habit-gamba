import { EmbedBuilder } from "discord.js";

export type DiscordMarketMetadata = {
  channelId?: string;
  guildId?: string | null;
  lastTradeRefresh?: unknown;
  summaryMessageId?: string;
  threadId?: string;
};
export type DiscordMarket = {
  closesAt: Date | null;
  description?: string | null;
  id: string;
  metadata?: Record<string, unknown>;
  prices?: { no: number; yes: number };
  slug: string;
  status: string;
  title: string;
};
export type MarketEmbedOptions = {
  outcome?: "NO" | "YES";
  reason?: string | null;
  title: string;
};

export function getDiscordMetadata(metadata: Record<string, unknown>): DiscordMarketMetadata {
  const discord = metadata.discord;

  if (!discord || typeof discord !== "object" || Array.isArray(discord)) {
    return {};
  }

  const record = discord as Record<string, unknown>;

  const result: DiscordMarketMetadata = {};
  const channelId = readString(record.channelId);
  const guildId = readString(record.guildId);
  const summaryMessageId = readString(record.summaryMessageId);
  const threadId = readString(record.threadId);

  if (channelId) {
    result.channelId = channelId;
  }

  if (guildId) {
    result.guildId = guildId;
  }

  if ("lastTradeRefresh" in record) {
    result.lastTradeRefresh = record.lastTradeRefresh;
  }

  if (summaryMessageId) {
    result.summaryMessageId = summaryMessageId;
  }

  if (threadId) {
    result.threadId = threadId;
  }

  return result;
}

export function mergeDiscordMetadata(
  metadata: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return mergeRecords(metadata, {
    discord: patch,
  });
}

export function marketEmbed(market: DiscordMarket, title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`**${market.title}**${market.description ? `\n${market.description}` : ""}`)
    .addFields(...marketSummaryFields(market))
    .setFooter({ text: `market ${market.id}` });
}

export function settlementMarketEmbed(
  market: DiscordMarket,
  options: MarketEmbedOptions,
): EmbedBuilder {
  const embed = marketEmbed(market, options.title);

  if (options.outcome) {
    embed.addFields({ name: "Resolution", value: `${options.outcome} won`, inline: true });
  }

  if (options.reason) {
    embed.addFields({ name: "Reason", value: options.reason, inline: false });
  }

  return embed;
}

export function pricesFromMarketMetadata(
  metadata: Record<string, unknown>,
): { no: number; yes: number } | undefined {
  const prices = metadata.settlementPrices;

  if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
    return undefined;
  }

  const record = prices as Record<string, unknown>;

  return typeof record.no === "number" && typeof record.yes === "number"
    ? { no: record.no, yes: record.yes }
    : undefined;
}

function marketSummaryFields(market: {
  closesAt: Date | null;
  prices?: { no: number; yes: number };
  slug: string;
  status: string;
}) {
  return [
    { name: "Slug", value: market.slug, inline: true },
    { name: "Status", value: market.status, inline: true },
    {
      name: "Closes",
      value: market.closesAt ? formatCloseDate(market.closesAt) : "not open",
      inline: true,
    },
    {
      name: "YES",
      value: market.prices ? formatPercent(market.prices.yes) : "50.0%",
      inline: true,
    },
    {
      name: "NO",
      value: market.prices ? formatPercent(market.prices.no) : "50.0%",
      inline: true,
    },
  ];
}

function formatCloseDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
  }).format(date);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function mergeRecords(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...left,
    ...Object.fromEntries(
      Object.entries(right).map(([key, value]) => {
        const leftValue = left[key];
        return [
          key,
          isRecord(leftValue) && isRecord(value) ? mergeRecords(leftValue, value) : value,
        ];
      }),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
