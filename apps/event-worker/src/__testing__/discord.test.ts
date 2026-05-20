import { describe, expect, it } from "vitest";

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
          title: "Market 1",
        },
        outcome: "YES",
        summaryTitle: "Market resolved",
      }),
    ).resolves.toEqual({
      outcome: "skipped",
      reason: "missing_discord_thread_id",
    });
  });
});
