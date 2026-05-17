import { describe, expect, it } from "vitest";

import { BotApiError } from "../service";
import { parseCloseDate, userFacingErrorMessage } from "../handlers/utils";

describe("bot market utilities", () => {
  it("parses close dates as 11:59:59pm America/New_York", () => {
    expect(parseCloseDate("05/24/2026").toISOString()).toBe("2026-05-25T03:59:59.000Z");
    expect(parseCloseDate("12/24/2026").toISOString()).toBe("2026-12-25T04:59:59.000Z");
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
