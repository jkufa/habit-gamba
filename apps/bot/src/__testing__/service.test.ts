import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveMarketCommand } from "../service";

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
          "X-Provider": "discord",
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
});

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
