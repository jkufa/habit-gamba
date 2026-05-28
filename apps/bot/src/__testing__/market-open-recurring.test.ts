import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMarket, handleMarketButton, handleMarketModal } from "../handlers/market";
import * as service from "../service";

type ButtonJson = {
  custom_id?: string;
  label?: string;
};

vi.mock("../service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../service")>();

  return {
    ...actual,
    autocompleteMarkets: vi.fn(),
    createMarketCommand: vi.fn(),
    getDiscordUser: vi.fn(),
    openMarketCommand: vi.fn(),
    writeMarketDiscordMetadata: vi.fn(),
  };
});

const services = {
  apiBaseUrl: "https://api.example.test",
  botApiToken: "bot-token",
};

const context = {
  client: {
    channels: {
      fetch: vi.fn(),
    },
  },
  services,
};

describe("market open recurring flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.autocompleteMarkets).mockResolvedValue([mockMarket({ status: "draft" })]);
    vi.mocked(service.createMarketCommand).mockResolvedValue({
      market: mockMarket({ status: "draft" }),
      opened: false,
    });
    vi.mocked(service.getDiscordUser).mockResolvedValue(mockUser());
    vi.mocked(service.openMarketCommand).mockResolvedValue(
      mockMarket({
        closesAt: new Date("2099-01-02T04:59:59.000Z"),
        prices: { no: 0.5, yes: 0.5 },
        status: "open",
        title: "Draft _market_",
      }),
    );
  });

  it("redirects slash open recurring to recurring schedule UI", async () => {
    const interaction = chatInputInteraction({
      market: "draft-market",
      recurring: true,
    });

    await handleMarket(context as never, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        content: "Select repeat days.",
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(service.openMarketCommand).not.toHaveBeenCalled();
  });

  it("adds open and schedule recurring buttons to draft create reply", async () => {
    const interaction = modalInteraction("market-create", {
      description: "",
      title: "Draft market",
    });

    await handleMarketModal(context as never, interaction);

    const reply = vi.mocked(interaction.reply).mock.calls[0]?.[0];
    const buttons =
      reply && "components" in reply
        ? (reply.components?.[0]?.toJSON().components as ButtonJson[] | undefined)
        : [];

    expect(buttons?.map((button) => button.label)).toEqual(["Open now", "Schedule recurring"]);
    expect(buttons?.map((button) => button.custom_id)).toEqual([
      "market-open-now:market-1:discord-1",
      "market-recurring-start:market-1:discord-1",
    ]);
  });

  it("starts recurring schedule from draft reply button", async () => {
    const interaction = buttonInteraction("market-recurring-start:market-1:discord-1");

    await handleMarketButton(context as never, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        content: "Select repeat days.",
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(service.openMarketCommand).not.toHaveBeenCalled();
  });

  it("redirects modal recurring yes to recurring schedule UI", async () => {
    const interaction = modalInteraction("market-open:market-1", {
      closes_at: "01/01/2099",
      recurring: "yes",
    });

    await handleMarketModal(context as never, interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        components: expect.any(Array),
        content: "Select repeat days.",
        flags: MessageFlags.Ephemeral,
      }),
    );
    expect(service.openMarketCommand).not.toHaveBeenCalled();
  });

  it("keeps modal blank recurring as one-off open", async () => {
    const interaction = modalInteraction("market-open:market-1", {
      closes_at: "01/01/2099",
      recurring: "",
    });

    await handleMarketModal(context as never, interaction);

    expect(service.openMarketCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        closesAt: new Date("2099-01-02T04:59:59.000Z"),
        marketId: "market-1",
      }),
    );
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Market opened: **Draft \\_market\\_**" }),
    );
  });

  it("rejects invalid modal recurring value", async () => {
    const interaction = modalInteraction("market-open:market-1", {
      closes_at: "01/01/2099",
      recurring: "maybe",
    });

    await handleMarketModal(context as never, interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Recurring must be yes or no.",
      flags: MessageFlags.Ephemeral,
    });
    expect(service.openMarketCommand).not.toHaveBeenCalled();
  });
});

function mockUser(): service.BotUser {
  return {
    displayName: "Creator",
    handle: "creator",
    id: "user-1",
    metadata: {},
    provider: "discord",
    providerUserId: "discord-1",
    status: "active",
  };
}

function mockMarket(overrides: Partial<service.BotMarket> = {}): service.BotMarket {
  return {
    closesAt: null,
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
    recurrenceDate: null,
    recurringSeriesId: null,
    slug: "draft-market",
    status: "draft",
    title: "Draft market",
    ...overrides,
  };
}

function chatInputInteraction(input: { market: string | null; recurring: boolean }) {
  return {
    channel: null,
    options: {
      getBoolean: vi.fn((name: string) => (name === "recurring" ? input.recurring : null)),
      getString: vi.fn((name: string) => (name === "market" ? input.market : null)),
      getSubcommand: vi.fn(() => "open"),
      getSubcommandGroup: vi.fn(() => null),
    },
    guild: { name: "Guild" },
    guildId: "guild-1",
    reply: vi.fn(),
    user: { id: "discord-1" },
  } as unknown as ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn> };
}

function modalInteraction(customId: string, fields: Record<string, string>) {
  return {
    channel: null,
    channelId: "channel-1",
    customId,
    fields: {
      getTextInputValue: vi.fn((name: string) => {
        if (!(name in fields)) {
          throw new Error(`Missing field ${name}`);
        }

        return fields[name];
      }),
    },
    guildId: "guild-1",
    reply: vi.fn(),
    user: { id: "discord-1" },
  } as unknown as ModalSubmitInteraction & { reply: ReturnType<typeof vi.fn> };
}

function buttonInteraction(customId: string) {
  return {
    channel: null,
    channelId: "channel-1",
    customId,
    guildId: "guild-1",
    reply: vi.fn(),
    user: { id: "discord-1" },
  } as unknown as Parameters<typeof handleMarketButton>[1] & { reply: ReturnType<typeof vi.fn> };
}
