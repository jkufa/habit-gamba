import { describe, expect, it } from "vitest";

import { composeMarketNotification } from "../index";

describe("notification composition", () => {
  it("composes resolved market notifications", () => {
    expect(
      composeMarketNotification({
        event: {
          payload: { outcome: "YES" },
          type: "market.resolved",
        },
        market: market(),
      }),
    ).toMatchObject({
      content: "Market resolved: YES won.",
      eventType: "market.resolved",
      kind: "market_resolved",
      outcome: "YES",
    });
  });

  it("composes voided market notifications", () => {
    expect(
      composeMarketNotification({
        event: {
          payload: { reason: "admin" },
          type: "market.voided",
        },
        market: market(),
      }),
    ).toMatchObject({
      content: "Market cancelled: admin",
      eventType: "market.voided",
      kind: "market_voided",
      reason: "admin",
    });
  });
});

function market() {
  return {
    closesAt: null,
    id: "market_1",
    metadata: {},
    slug: "market-1",
    status: "resolved",
    title: "Market 1",
  };
}
