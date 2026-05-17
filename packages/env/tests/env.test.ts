import { describe, expect, it } from "vitest";

import { loadBaseEnv, loadBotEnv } from "../src/index";

describe("loadBaseEnv", () => {
  it("accepts valid local config", () => {
    expect(
      loadBaseEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        LOG_LEVEL: "debug",
        NODE_ENV: "test",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
      LOG_LEVEL: "debug",
      NODE_ENV: "test",
    });
  });

  it("rejects missing database url", () => {
    expect(() => loadBaseEnv({})).toThrow();
    expect(() => loadBaseEnv({ NODE_ENV: "test" })).toThrow();
  });
});

describe("loadBotEnv", () => {
  it("accepts Discord bot config", () => {
    expect(
      loadBotEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        DISCORD_APPLICATION_ID: "app",
        DISCORD_BOT_TOKEN: "token",
        DISCORD_DEV_GUILD_ID: "guild",
      }),
    ).toMatchObject({
      DISCORD_APPLICATION_ID: "app",
      DISCORD_BOT_TOKEN: "token",
      DISCORD_DEV_GUILD_ID: "guild",
    });
  });

  it("accepts legacy DEV_GUILD_ID alias", () => {
    expect(
      loadBotEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        DEV_GUILD_ID: "guild",
        DISCORD_APPLICATION_ID: "app",
        DISCORD_BOT_TOKEN: "token",
      }).DISCORD_DEV_GUILD_ID,
    ).toBe("guild");
  });
});
