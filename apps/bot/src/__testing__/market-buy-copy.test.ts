import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMarket } from "../handlers/market";
import * as service from "../service";

vi.mock("../service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../service")>();

  return {
    ...actual,
    autocompleteMarkets: vi.fn(),
    buyMarketCommand: vi.fn(),
    getDiscordUser: vi.fn(),
    writeMarketDiscordMetadata: vi.fn(),
  };
});

const services = {
  apiBaseUrl: "https://api.example.test",
  botApiToken: "bot-token",
};

describe("market buy copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.autocompleteMarkets).mockResolvedValue([mockMarket()]);
    vi.mocked(service.getDiscordUser).mockResolvedValue({
      displayName: "API Buyer",
      handle: "api-buyer",
      id: "user-1",
      metadata: {},
      provider: "discord",
      providerUserId: "discord-1",
      status: "active",
    });
    vi.mocked(service.buyMarketCommand).mockResolvedValue({
      idempotent: false,
      ledgerEntry: {} as never,
      market: mockMarket({
        metadata: {
          discord: {
            summaryMessageId: "summary-1",
            threadId: "thread-1",
          },
        },
      }),
      position: {} as never,
      quote: {
        costMicro: 2_000_000n,
        outcome: "YES",
        pricesAfter: { no: 0.4, yes: 0.6 },
        pricesBefore: { no: 0.5, yes: 0.5 },
        sharesMicro: 4_000_000n,
      },
      trade: {} as never,
    });
  });

  it("replies privately with total spend and posts lighter public thread copy", async () => {
    const summaryMessage = { edit: vi.fn() };
    const thread = {
      id: "thread-1",
      isThread: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(summaryMessage),
      },
      send: vi.fn(),
    };
    const context = {
      client: {
        channels: {
          fetch: vi.fn().mockResolvedValue(thread),
        },
      },
      services,
    };
    const interaction = chatInputInteraction();

    await handleMarket(context as never, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "You bought 4.00 YES shares @ 0.50 REP for 2.00 REP.",
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(thread.send).toHaveBeenCalledWith({
      content: "API Buyer (@api-buyer) bought 4.00 YES shares @ 0.50 REP",
    });
  });
});

function chatInputInteraction() {
  return {
    channel: null,
    options: {
      getString: vi.fn((name: string) => {
        const values: Record<string, string> = {
          market: "market-1",
          mode: "spend_rep",
          outcome: "YES",
          spend_rep: "2",
        };

        return values[name] ?? null;
      }),
      getSubcommand: vi.fn(() => "buy"),
      getSubcommandGroup: vi.fn(() => null),
    },
    guild: { name: "Guild" },
    guildId: "guild-1",
    reply: vi.fn(),
    user: { id: "discord-1" },
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

function mockMarket(overrides: Partial<service.BotMarket> = {}): service.BotMarket {
  return {
    closesAt: new Date("2099-01-02T04:59:59.000Z"),
    contracts: [
      {
        id: "contract-yes",
        marketId: "market-1",
        outcome: "YES",
        shareSupplyMicro: 0n,
        title: "YES",
      },
      {
        id: "contract-no",
        marketId: "market-1",
        outcome: "NO",
        shareSupplyMicro: 0n,
        title: "NO",
      },
    ],
    creatorUserId: "user-1",
    description: null,
    id: "market-1",
    metadata: {},
    prices: { no: 0.5, yes: 0.5 },
    recurrenceDate: null,
    recurringSeriesId: null,
    slug: "market-1",
    status: "open",
    title: "Market 1",
    ...overrides,
  };
}
