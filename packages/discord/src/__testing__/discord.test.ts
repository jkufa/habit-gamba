import { describe, expect, it } from "vitest";

import { getDiscordMetadata, mergeDiscordMetadata, pricesFromMarketMetadata } from "../index";

describe("discord helpers", () => {
  it("reads typed Discord metadata", () => {
    expect(
      getDiscordMetadata({
        discord: {
          channelId: "channel_1",
          guildId: "guild_1",
          summaryMessageId: "message_1",
          threadId: "thread_1",
        },
      }),
    ).toMatchObject({
      channelId: "channel_1",
      guildId: "guild_1",
      summaryMessageId: "message_1",
      threadId: "thread_1",
    });
  });

  it("merges Discord metadata without dropping existing keys", () => {
    expect(
      mergeDiscordMetadata(
        { discord: { threadId: "thread_1" }, qa: true },
        { summaryMessageId: "message_1" },
      ),
    ).toEqual({
      discord: {
        summaryMessageId: "message_1",
        threadId: "thread_1",
      },
      qa: true,
    });
  });

  it("reads settlement prices", () => {
    expect(pricesFromMarketMetadata({ settlementPrices: { no: 0.25, yes: 0.75 } })).toEqual({
      no: 0.25,
      yes: 0.75,
    });
  });
});
