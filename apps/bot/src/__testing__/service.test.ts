import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adjustUserBalanceCommand,
  buyMarketCommand,
  findMarketByDiscordThread,
  getLeaderboardCommand,
  resolveMarketCommand,
  sellMarketCommand,
} from "../service";

const community = {
  displayName: "Test Guild",
  provider: "discord" as const,
  providerCommunityId: "guild-1",
};

describe("bot API service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses hydrated market returned by resolve command", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            idempotent: false,
            ledgerEntries: [],
            market: marketResponse(),
            resolution: {
              id: "resolution-1",
              marketId: "market-1",
              resolvedAt: "2026-05-17T17:44:58.000Z",
              resolverUserId: "user-1",
              winningContractId: "contract-yes",
            },
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveMarketCommand({
      actor: {
        community,
        discordUserId: "discord-1",
        userId: "user-1",
      },
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
      evidence: { note: "proof" },
      marketId: "market-1",
      outcome: "YES",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/markets/market-1/resolve", "https://api.example.test"),
      {
        body: JSON.stringify({
          evidence: { note: "proof" },
          outcome: "YES",
        }),
        headers: {
          Authorization: "Bearer bot-token",
          "Content-Type": "application/json",
          "X-Community-Provider": "discord",
          "X-Provider": "discord",
          "X-Provider-Community-Id": "guild-1",
          "X-Provider-User-Id": "discord-1",
        },
        method: "POST",
      },
    );
    expect(result.market.status).toBe("resolved");
    expect(result.market.closesAt).toBeInstanceOf(Date);
    expect(result.market.closesAt?.toISOString()).toBe("2026-05-20T03:59:59.000Z");
    expect(result.market.contracts).toHaveLength(2);
    expect(result.market.contracts[0]?.shareSupplyMicro).toBe(0n);
  });

  it("fetches and parses global leaderboard entries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            entries: [
              {
                balance: {
                  availableAmountMicro: "1234000000",
                  creditLimitMicro: "0",
                  currency: "REP",
                  lockedAmountMicro: "0",
                  userId: "user-1",
                },
                rank: 1,
                user: userResponse(),
              },
            ],
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await getLeaderboardCommand({
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
      community,
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/leaderboard?limit=10", "https://api.example.test"),
      {
        body: undefined,
        headers: {
          Authorization: "Bearer bot-token",
          "Content-Type": "application/json",
          "X-Community-Provider": "discord",
          "X-Provider-Community-Id": "guild-1",
        },
        method: "GET",
      },
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.balance.availableAmountMicro).toBe(1234000000n);
    expect(result.entries[0]?.user.displayName).toBe("Leaderboard User");
  });

  it("sends admin balance adjustments with actor auth and idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            balance: {
              availableAmountMicro: "1234000000",
              creditLimitMicro: "0",
              currency: "REP",
              lockedAmountMicro: "0",
              userId: "target-user",
            },
            idempotent: false,
            ledgerEntry: {
              amountDeltaMicro: "1234000000",
              balanceAfterMicro: "1234000000",
              createdAt: "2026-05-17T17:44:29.015Z",
              currency: "REP",
              id: "ledger-1",
              idempotencyKey: "idem-1",
              metadata: {},
              reason: "adjustment",
              sourceId: "source-1",
              sourceType: "account_adjustment",
              userId: "target-user",
            },
            user: userResponse("target-user", "discord-target", "Target User"),
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await adjustUserBalanceCommand({
      actor: {
        community,
        discordUserId: "discord-admin",
        userId: "admin-user",
      },
      amountMicro: 1234000000n,
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
      direction: "credit",
      reason: "manual fix",
      targetUserId: "target-user",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toEqual(new URL("/accounts/target-user/adjustments", "https://api.example.test"));
    expect(init).toMatchObject({
      body: JSON.stringify({
        amountMicro: "1234000000",
        direction: "credit",
        reason: "manual fix",
      }),
      headers: {
        Authorization: "Bearer bot-token",
        "Content-Type": "application/json",
        "X-Provider": "discord",
        "X-Provider-User-Id": "discord-admin",
      },
      method: "POST",
    });
    expect((init as { headers: Record<string, string> }).headers["Idempotency-Key"]).toMatch(
      /^discord:discord-admin:admin:credit:/u,
    );
    expect(result.balance.availableAmountMicro).toBe(1234000000n);
    expect(result.ledgerEntry.amountDeltaMicro).toBe(1234000000n);
    expect(result.user.id).toBe("target-user");
  });

  it("sends buy_shares mode for exact-share buys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            idempotent: false,
            ledgerEntry: {
              amountDeltaMicro: "-1230000",
              balanceAfterMicro: "998770000",
              createdAt: "2026-05-17T17:44:29.015Z",
              currency: "REP",
              id: "ledger-1",
              idempotencyKey: "idem-1",
              metadata: {},
              reason: "trade",
              sourceId: "source-1",
              sourceType: "exchange_trade",
              userId: "user-1",
            },
            market: marketResponse(),
            position: {
              contractId: "contract-yes",
              id: "position-1",
              quantityMicro: "2000000",
              userId: "user-1",
            },
            quote: {
              costMicro: "1230000",
              outcome: "YES",
              pricesAfter: { no: 0.49, yes: 0.51 },
              pricesBefore: { no: 0.5, yes: 0.5 },
              sharesMicro: "2000000",
            },
            trade: {
              cashDeltaMicro: "-1230000",
              contractId: "contract-yes",
              createdAt: "2026-05-17T17:44:29.015Z",
              feeMicro: "0",
              id: "trade-1",
              idempotencyKey: "idem-1",
              marketId: "market-1",
              metadata: {},
              sharesDeltaMicro: "2000000",
              side: "buy",
              userId: "user-1",
            },
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await buyMarketCommand({
      actor: {
        community,
        discordUserId: "discord-1",
        userId: "user-1",
      },
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
      marketId: "market-1",
      mode: "buy_shares",
      outcome: "YES",
      value: "2",
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(init).toMatchObject({
      body: JSON.stringify({
        amountMicro: "2000000",
        mode: "buy_shares",
        outcome: "YES",
      }),
      headers: {
        Authorization: "Bearer bot-token",
        "Content-Type": "application/json",
        "X-Provider": "discord",
        "X-Provider-User-Id": "discord-1",
      },
      method: "POST",
    });
    expect((init as { headers: Record<string, string> }).headers["Idempotency-Key"]).toMatch(
      /^discord:discord-1:buy:/u,
    );
    expect(result.quote.sharesMicro).toBe(2000000n);
  });

  it("sends target_rep mode for target-payout sells", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            idempotent: false,
            ledgerEntry: {
              amountDeltaMicro: "1230000",
              balanceAfterMicro: "1001230000",
              createdAt: "2026-05-17T17:44:29.015Z",
              currency: "REP",
              id: "ledger-1",
              idempotencyKey: "idem-1",
              metadata: {},
              reason: "payout",
              sourceId: "source-1",
              sourceType: "exchange_trade",
              userId: "user-1",
            },
            market: marketResponse(),
            position: {
              contractId: "contract-yes",
              id: "position-1",
              quantityMicro: "1000000",
              userId: "user-1",
            },
            quote: {
              costMicro: "1230000",
              outcome: "YES",
              pricesAfter: { no: 0.51, yes: 0.49 },
              pricesBefore: { no: 0.5, yes: 0.5 },
              sharesMicro: "2000000",
            },
            trade: {
              cashDeltaMicro: "1230000",
              contractId: "contract-yes",
              createdAt: "2026-05-17T17:44:29.015Z",
              feeMicro: "0",
              id: "trade-1",
              idempotencyKey: "idem-1",
              marketId: "market-1",
              metadata: {},
              sharesDeltaMicro: "-2000000",
              side: "sell",
              userId: "user-1",
            },
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 201,
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await sellMarketCommand({
      actor: {
        community,
        discordUserId: "discord-1",
        userId: "user-1",
      },
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
      marketId: "market-1",
      mode: "target_rep",
      outcome: "YES",
      value: "1.23",
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];

    expect(init).toMatchObject({
      body: JSON.stringify({
        amountMicro: "1230000",
        mode: "target_rep",
        outcome: "YES",
      }),
      method: "POST",
    });
    expect((init as { headers: Record<string, string> }).headers["Idempotency-Key"]).toMatch(
      /^discord:discord-1:sell:/u,
    );
    expect(result.quote.costMicro).toBe(1230000n);
    expect(result.trade.side).toBe("sell");
  });

  it("finds markets by Discord thread and treats 404 as no default", async () => {
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

    const services = {
      apiBaseUrl: "https://api.example.test",
      botApiToken: "bot-token",
    };
    const found = await findMarketByDiscordThread({ ...services, community, threadId: "thread-1" });
    const missing = await findMarketByDiscordThread({
      ...services,
      community,
      threadId: "missing-thread",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/markets/by-discord-thread/thread-1", "https://api.example.test"),
      {
        body: undefined,
        headers: {
          Authorization: "Bearer bot-token",
          "Content-Type": "application/json",
          "X-Community-Provider": "discord",
          "X-Provider-Community-Id": "guild-1",
        },
        method: "GET",
      },
    );
    expect(found?.id).toBe("market-1");
    expect(found?.closesAt).toBeInstanceOf(Date);
    expect(found?.contracts[0]?.shareSupplyMicro).toBe(0n);
    expect(missing).toBeNull();
  });
});

function userResponse(
  id = "user-1",
  providerUserId = "discord-1",
  displayName = "Leaderboard User",
) {
  return {
    createdAt: "2026-05-17T17:44:29.015Z",
    displayName,
    handle: "leaderboard-user",
    id,
    metadata: {},
    provider: "discord",
    providerUserId,
    status: "active",
    updatedAt: "2026-05-17T17:44:29.015Z",
  };
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
    resolvedAt: "2026-05-17T17:44:58.000Z",
    slug: "market-fh2zeq",
    status: "resolved",
    title: "'",
    updatedAt: "2026-05-17T17:44:58.000Z",
    voidedAt: null,
  };
}
