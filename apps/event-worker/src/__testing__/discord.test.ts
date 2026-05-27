import { describe, expect, it, vi } from "vitest";

import type { DbClient } from "@habit-gamba/db";
import type { REST } from "discord.js";

import { createDiscordDeliveryProvider } from "../discord";

describe("discord delivery provider", () => {
  it("skips market notifications without a thread target", async () => {
    const provider = createDiscordDeliveryProvider({
      db: {} as DbClient,
      rest: {} as REST,
    });

    await expect(
      provider.deliver({
        content: "Market resolved: YES won.",
        eventType: "market.resolved",
        kind: "market_resolved",
        market: {
          closesAt: null,
          id: "market_1",
          metadata: {},
          slug: "market-1",
          status: "resolved",
          title: "Market _1_",
        },
        outcome: "YES",
        summaryTitle: "Market resolved",
      }),
    ).resolves.toEqual({
      outcome: "skipped",
      reason: "missing_discord_thread_id",
    });
  });

  it("uses a text-only root message and pinned thread summary for opened markets", async () => {
    const rest = {
      post: vi
        .fn()
        .mockResolvedValueOnce({ id: "parent-message-1" })
        .mockResolvedValueOnce({ id: "thread-1" })
        .mockResolvedValueOnce({ id: "summary-message-1" }),
      put: vi.fn().mockResolvedValue({}),
    };
    const returning = vi.fn().mockResolvedValue([]);
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning,
          })),
        })),
      })),
    };
    const provider = createDiscordDeliveryProvider({
      db: db as unknown as DbClient,
      rest: rest as unknown as REST,
    });

    await expect(
      provider.deliver({
        content: "Market opened: Market 1",
        eventType: "market.opened",
        kind: "market_opened",
        market: {
          closesAt: null,
          id: "market_1",
          metadata: {
            discord: {
              channelId: "channel-1",
              guildId: "guild-1",
            },
          },
          slug: "market-1",
          status: "open",
          title: "Market _1_",
        },
        summaryTitle: "Market opened",
      }),
    ).resolves.toEqual({
      outcome: "delivered",
    });

    expect(rest.post).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: {
          content: "Market opened: **Market \\_1\\_**",
        },
      }),
    );
    expect(rest.post).toHaveBeenNthCalledWith(
      3,
      expect.any(String),
      expect.objectContaining({
        body: {
          embeds: expect.any(Array),
        },
      }),
    );
    expect(rest.put).toHaveBeenCalledOnce();
  });

  it("posts terminal market notifications and closes the thread", async () => {
    const rest = {
      patch: vi.fn().mockResolvedValue({}),
      post: vi.fn().mockResolvedValue({ id: "terminal-message-1" }),
    };
    const provider = createDiscordDeliveryProvider({
      db: {} as DbClient,
      rest: rest as unknown as REST,
    });

    await expect(
      provider.deliver({
        content: "Market resolved: YES won.",
        eventType: "market.resolved",
        kind: "market_resolved",
        market: {
          closesAt: null,
          id: "market_1",
          metadata: {
            discord: {
              summaryMessageId: "summary-message-1",
              threadId: "thread-1",
            },
          },
          slug: "market-1",
          status: "resolved",
          title: "Market 1",
        },
        outcome: "YES",
        summaryTitle: "Market resolved",
      }),
    ).resolves.toEqual({
      outcome: "delivered",
    });

    expect(rest.patch).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: {
          embeds: expect.any(Array),
        },
      }),
    );
    expect(rest.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({
          content: "Market resolved: YES won.",
          embeds: expect.any(Array),
        }),
      }),
    );
    expect(rest.patch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: {
          archived: true,
          locked: true,
        },
        reason: "Habit Gamba terminal market thread",
      }),
    );
  });

  it("keeps terminal Discord steps independent after a summary failure", async () => {
    const errors: string[] = [];
    const rest = {
      patch: vi
        .fn()
        .mockRejectedValueOnce(new Error("summary unavailable"))
        .mockResolvedValueOnce({}),
      post: vi.fn().mockResolvedValue({ id: "terminal-message-1" }),
    };
    const provider = createDiscordDeliveryProvider({
      db: {} as DbClient,
      logger: {
        child: () => {
          throw new Error("unexpected child logger");
        },
        error: (event) => errors.push(event),
        info: () => undefined,
      },
      rest: rest as unknown as REST,
    });

    await expect(
      provider.deliver({
        content: "Market cancelled: admin.",
        eventType: "market.voided",
        kind: "market_voided",
        market: {
          closesAt: null,
          id: "market_1",
          metadata: {
            discord: {
              summaryMessageId: "summary-message-1",
              threadId: "thread-1",
            },
          },
          slug: "market-1",
          status: "void",
          title: "Market 1",
        },
        reason: "admin",
        summaryTitle: "Market cancelled",
      }),
    ).resolves.toEqual({
      outcome: "delivered",
    });

    expect(errors).toEqual(["discord_terminal_market_step_failed"]);
    expect(rest.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({
          content: "Market cancelled: admin.",
        }),
      }),
    );
    expect(rest.patch).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        body: {
          archived: true,
          locked: true,
        },
      }),
    );
  });
});
