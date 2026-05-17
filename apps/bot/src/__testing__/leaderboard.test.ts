import { describe, expect, it } from "vitest";

import { formatLeaderboardRows, normalizeLeaderboardLimit } from "../handlers/leaderboard";

describe("bot leaderboard utilities", () => {
  it("formats ranked REP leaderboard rows", () => {
    expect(
      formatLeaderboardRows([
        {
          balance: {
            availableAmountMicro: 1234560000n,
            creditLimitMicro: 0n,
            currency: "REP",
            lockedAmountMicro: 0n,
            userId: "user-1",
          },
          rank: 1,
          user: {
            displayName: "Demo User",
            handle: "demo",
            id: "user-1",
            metadata: {},
            provider: "discord",
            providerUserId: "discord-1",
            status: "active",
          },
        },
        {
          balance: {
            availableAmountMicro: 1037980000n,
            creditLimitMicro: 0n,
            currency: "REP",
            lockedAmountMicro: 0n,
            userId: "user-2",
          },
          rank: 2,
          user: {
            displayName: "garmour1",
            handle: "garmour1",
            id: "user-2",
            metadata: {},
            provider: "discord",
            providerUserId: "discord-2",
            status: "active",
          },
        },
      ]),
    ).toBe(
      ["```text", "#1  Demo User  1,234.56 REP", "#2  garmour1   1,037.98 REP", "```"].join("\n"),
    );
  });

  it("normalizes leaderboard limits for Discord display", () => {
    expect(normalizeLeaderboardLimit(null)).toBe(10);
    expect(normalizeLeaderboardLimit(0)).toBe(1);
    expect(normalizeLeaderboardLimit(99)).toBe(25);
  });
});
