import { describe, expect, it } from "vitest";

import {
  formatMarketRefreshTradeSummary,
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

  it("formats refresh trade messages with buyer, outcome, contracts, spend, and title", () => {
    expect(
      formatMarketRefreshTradeSummary({
        title: "Will API buys show up?",
        trade: trade(1, {
          buyerDisplayName: "API Buyer",
          buyerHandle: "api-buyer",
          cashDeltaMicro: -2_000_000n,
          sharesDeltaMicro: 1_234_500n,
        }),
      }),
    ).toBe(
      "API Buyer (@api-buyer) bought YES 1.23 contracts for 2.00 REP on Will API buys show up?",
    );
  });
});

function trade(index: number, overrides: Partial<MarketRefreshTrade> = {}): MarketRefreshTrade {
  const padded = String(index).padStart(2, "0");

  return {
    buyerDisplayName: `Buyer ${padded}`,
    buyerHandle: null,
    cashDeltaMicro: -1_000_000n,
    createdAt: new Date(`2026-05-17T12:00:${padded}.000Z`),
    id: `trade-${padded}`,
    outcome: "YES",
    sharesDeltaMicro: 1_000_000n,
    ...overrides,
  };
}
