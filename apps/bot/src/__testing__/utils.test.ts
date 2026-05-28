import { afterEach, describe, expect, it, vi } from "vitest";

import { BotApiError } from "../service";
import {
  formatMarketAutocompleteChoice,
  formatTodayEasternDate,
  parseCloseDate,
  resolveDefaultMarketValue,
  userFacingErrorMessage,
} from "../handlers/utils";

describe("bot market utilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps market autocomplete names within Discord limits", () => {
    const longTitle = "Will Jack complete his daily habit streak before the end of May?";
    const longSlug = "will-jack-complete-his-daily-habit-streak-before-end-of-may-abc123";

    expect(
      formatMarketAutocompleteChoice({ id: "market-id", slug: longSlug, title: longTitle }).length,
    ).toBeLessThanOrEqual(100);
    expect(
      formatMarketAutocompleteChoice({
        id: "market-id",
        slug: "x".repeat(120),
        title: "Short title",
      }).length,
    ).toBeLessThanOrEqual(100);
  });

  it("parses close dates as 11:59:59pm America/New_York", () => {
    expect(parseCloseDate("05/24/2026").toISOString()).toBe("2026-05-25T03:59:59.000Z");
    expect(parseCloseDate("12/24/2026").toISOString()).toBe("2026-12-25T04:59:59.000Z");
  });

  it("formats today using America/New_York", () => {
    expect(formatTodayEasternDate(new Date("2026-05-22T03:59:00.000Z"))).toBe("05/21/2026");
    expect(formatTodayEasternDate(new Date("2026-05-22T04:00:00.000Z"))).toBe("05/22/2026");
  });

  it("resolves missing market values from linked thread context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: marketResponse(),
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "MARKET_NOT_FOUND",
              message: "Market not found",
            },
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 404,
          },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const context = {
      services: {
        apiBaseUrl: "https://api.example.test",
        botApiToken: "bot-token",
      },
    };
    const threadInteraction = {
      channel: {
        id: "thread-1",
        isThread: () => true,
      },
      guild: { name: "Guild" },
      guildId: "guild-1",
    };
    const channelInteraction = {
      channel: {
        id: "channel-1",
        isThread: () => false,
      },
      guild: { name: "Guild" },
      guildId: "guild-1",
    };

    await expect(
      resolveDefaultMarketValue(context as never, threadInteraction as never, " explicit "),
    ).resolves.toBe("explicit");
    await expect(
      resolveDefaultMarketValue(context as never, channelInteraction as never, null),
    ).resolves.toBeNull();
    await expect(
      resolveDefaultMarketValue(context as never, threadInteraction as never, null),
    ).resolves.toBe("market-1");
    await expect(
      resolveDefaultMarketValue(context as never, threadInteraction as never, null),
    ).resolves.toBeNull();
  });

  it("rejects non MM/DD/YYYY close dates", () => {
    expect(() => parseCloseDate("2026-05-24")).toThrow("MM/DD/YYYY");
    expect(() => parseCloseDate("02/31/2026")).toThrow("real date");
  });

  it("maps market tradeability errors to user-facing copy", () => {
    expect(messageForStatus("draft")).toBe("This market is not open yet.");
    expect(messageForStatus("closed")).toBe("This market is closed.");
    expect(messageForStatus("resolved")).toBe("This market is already resolved.");
    expect(messageForStatus("void")).toBe("This market was cancelled.");
    expect(
      userFacingErrorMessage(
        new BotApiError(422, "MARKET_NOT_TRADEABLE", "Market does not accept trades", {
          closesAt: "2026-05-24T03:59:59.000Z",
          marketId: "market-a",
          now: "2026-05-24T04:00:00.000Z",
          status: "open",
        }),
      ),
    ).toBe("This market is past its close time.");
  });
});

function messageForStatus(status: string) {
  return userFacingErrorMessage(
    new BotApiError(422, "MARKET_NOT_TRADEABLE", "Market does not accept trades", {
      closesAt: null,
      marketId: "market-a",
      now: "2026-05-24T00:00:00.000Z",
      status,
    }),
  );
}

function marketResponse() {
  return {
    closedAt: null,
    closesAt: "2026-05-20T03:59:59.000Z",
    contracts: [
      {
        createdAt: "2026-05-17T17:44:29.015Z",
        id: "contract-yes",
        marketId: "market-1",
        outcome: "YES",
        shareSupplyMicro: "0",
        title: "YES",
        updatedAt: "2026-05-17T17:44:29.015Z",
      },
      {
        createdAt: "2026-05-17T17:44:29.015Z",
        id: "contract-no",
        marketId: "market-1",
        outcome: "NO",
        shareSupplyMicro: "0",
        title: "NO",
        updatedAt: "2026-05-17T17:44:29.015Z",
      },
    ],
    createdAt: "2026-05-17T17:44:29.015Z",
    creatorUserId: "user-1",
    currency: "REP",
    description: "Will mark when in melee today",
    id: "market-1",
    liquidityParameterMicro: "0",
    metadata: {},
    openedAt: "2026-05-17T17:44:48.282Z",
    oracleAdapter: null,
    oracleRef: null,
    prices: { no: 0.5, yes: 0.5 },
    resolvedAt: null,
    slug: "market-fh2zeq",
    status: "open",
    title: "'",
    updatedAt: "2026-05-17T17:44:58.000Z",
    voidedAt: null,
  };
}
