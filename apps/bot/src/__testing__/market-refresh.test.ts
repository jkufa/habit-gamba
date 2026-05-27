import { describe, expect, it } from "vitest";

import {
  formatMarketRefreshTradeSummary,
  formatPrivateSellSummary,
  formatPrivateTradeSummary,
  formatPublicSellSummary,
  formatPublicTradeSummary,
  selectMarketRefreshTradesForPosting,
  serializeLastTradeRefresh,
  type MarketRefreshTrade,
} from "../service";

describe("market refresh trades", () => {
  it("posts latest 10 existing trades oldest-to-newest on first refresh", () => {
    const trades = Array.from({ length: 12 }, (_, index) => trade(index + 1));
    const selected = selectMarketRefreshTradesForPosting(trades);

    expect(selected.map((item) => item.id)).toEqual([
      "trade-03",
      "trade-04",
      "trade-05",
      "trade-06",
      "trade-07",
      "trade-08",
      "trade-09",
      "trade-10",
      "trade-11",
      "trade-12",
    ]);
  });

  it("posts only trades newer than last refresh", () => {
    const trades = Array.from({ length: 6 }, (_, index) => trade(index + 1));
    const selected = selectMarketRefreshTradesForPosting(
      trades,
      serializeLastTradeRefresh(trade(3)),
    );

    expect(selected.map((item) => item.id)).toEqual(["trade-04", "trade-05", "trade-06"]);
  });

  it("uses trade id as same-timestamp marker tie-break", () => {
    const createdAt = new Date("2026-05-17T12:00:00.000Z");
    const selected = selectMarketRefreshTradesForPosting(
      [
        trade(1, { createdAt, id: "trade-a" }),
        trade(1, { createdAt, id: "trade-b" }),
        trade(1, { createdAt, id: "trade-c" }),
      ],
      { createdAt: createdAt.toISOString(), id: "trade-b" },
    );

    expect(selected.map((item) => item.id)).toEqual(["trade-c"]);
  });

  it("formats public trade messages with buyer, outcome, shares, and entry price", () => {
    expect(
      formatPublicTradeSummary({
        costMicro: 2_000_000n,
        outcome: "YES",
        sharesMicro: 4_000_000n,
        user: {
          displayName: "API Buyer",
          handle: "api-buyer",
        },
      }),
    ).toBe("API Buyer (@api-buyer) bought 4.00 YES shares @ 0.50 REP");
  });

  it("formats public trade messages without handle", () => {
    expect(
      formatPublicTradeSummary({
        costMicro: 1_000_000n,
        outcome: "NO",
        sharesMicro: 2_000_000n,
        user: {
          displayName: "API Buyer",
          handle: null,
        },
      }),
    ).toBe("API Buyer bought 2.00 NO shares @ 0.50 REP");
  });

  it("formats private trade confirmations with total spend", () => {
    expect(
      formatPrivateTradeSummary({
        costMicro: 2_000_000n,
        outcome: "YES",
        sharesMicro: 4_000_000n,
      }),
    ).toBe("You bought 4.00 YES shares @ 0.50 REP for 2.00 REP.");
  });

  it("formats public sell messages with seller, outcome, shares, and payout", () => {
    expect(
      formatPublicSellSummary({
        outcome: "YES",
        payoutMicro: 2_000_000n,
        sharesMicro: 4_000_000n,
        user: {
          displayName: "API Seller",
          handle: "api-seller",
        },
      }),
    ).toBe("API Seller (@api-seller) sold 4.00 YES shares for 2.00 REP.");
  });

  it("formats private sell confirmations with total received", () => {
    expect(
      formatPrivateSellSummary({
        outcome: "NO",
        payoutMicro: 1_500_000n,
        sharesMicro: 3_000_000n,
      }),
    ).toBe("You sold 3.00 NO shares for 1.50 REP.");
  });

  it("rounds entry price using integer math", () => {
    expect(
      formatPublicTradeSummary({
        costMicro: 1_000_000n,
        outcome: "YES",
        sharesMicro: 3_000_000n,
        user: {
          displayName: "API Buyer",
          handle: null,
        },
      }),
    ).toBe("API Buyer bought 3.00 YES shares @ 0.33 REP");
  });

  it("rejects non-positive share quantities for entry price", () => {
    expect(() =>
      formatPublicTradeSummary({
        costMicro: 1_000_000n,
        outcome: "YES",
        sharesMicro: 0n,
        user: {
          displayName: "API Buyer",
          handle: null,
        },
      }),
    ).toThrow("sharesMicro must be positive");
  });

  it("formats refresh trade messages with same public trade copy", () => {
    expect(
      formatMarketRefreshTradeSummary({
        trade: trade(1, {
          actorDisplayName: "API Buyer",
          actorHandle: "api-buyer",
          cashDeltaMicro: -2_000_000n,
          sharesDeltaMicro: 4_000_000n,
        }),
      }),
    ).toBe("API Buyer (@api-buyer) bought 4.00 YES shares @ 0.50 REP");
  });

  it("formats refresh sell messages with sell copy", () => {
    expect(
      formatMarketRefreshTradeSummary({
        trade: trade(1, {
          actorDisplayName: "API Seller",
          actorHandle: "api-seller",
          cashDeltaMicro: 2_000_000n,
          sharesDeltaMicro: -4_000_000n,
          side: "sell",
        }),
      }),
    ).toBe("API Seller (@api-seller) sold 4.00 YES shares for 2.00 REP.");
  });
});

function trade(index: number, overrides: Partial<MarketRefreshTrade> = {}): MarketRefreshTrade {
  const padded = String(index).padStart(2, "0");

  return {
    actorDisplayName: `Buyer ${padded}`,
    actorHandle: null,
    cashDeltaMicro: -1_000_000n,
    createdAt: new Date(`2026-05-17T12:00:${padded}.000Z`),
    id: `trade-${padded}`,
    outcome: "YES",
    sharesDeltaMicro: 1_000_000n,
    side: "buy",
    ...overrides,
  };
}
