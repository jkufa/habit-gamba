import { describe, expect, it } from "vitest";

import { loadBaseEnv, loadBotEnv, loadBotRuntimeEnv, loadServerEnv } from "../src/index";

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

  it("requires API config for bot runtime", () => {
    expect(
      loadBotRuntimeEnv({
        API_BASE_URL: "http://localhost:3000",
        BOT_API_TOKEN: "bot-token",
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        DISCORD_APPLICATION_ID: "app",
        DISCORD_BOT_TOKEN: "token",
        DISCORD_DEV_GUILD_ID: "guild",
      }),
    ).toMatchObject({
      API_BASE_URL: "http://localhost:3000",
      BOT_API_TOKEN: "bot-token",
      DISCORD_DEV_GUILD_ID: "guild",
    });
  });

  it("accepts production bot runtime without dev guild id", () => {
    expect(
      loadBotRuntimeEnv({
        API_BASE_URL: "http://api-server.railway.internal:3000",
        BOT_API_TOKEN: "bot-token",
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        DISCORD_APPLICATION_ID: "app",
        DISCORD_BOT_TOKEN: "token",
        NODE_ENV: "production",
      }),
    ).toMatchObject({
      API_BASE_URL: "http://api-server.railway.internal:3000",
      BOT_API_TOKEN: "bot-token",
      DISCORD_APPLICATION_ID: "app",
    });
  });

  it("rejects missing API config for bot runtime", () => {
    expect(() =>
      loadBotRuntimeEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        DISCORD_APPLICATION_ID: "app",
        DISCORD_BOT_TOKEN: "token",
        DISCORD_DEV_GUILD_ID: "guild",
      }),
    ).toThrow();
  });
});

describe("loadServerEnv", () => {
  it("accepts explicit bot API token for server", () => {
    expect(
      loadServerEnv({
        BOT_API_TOKEN: "bot-token",
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
      }).BOT_API_TOKEN,
    ).toBe("bot-token");
  });

  it("uses Railway PORT when SERVER_PORT is not set", () => {
    expect(
      loadServerEnv({
        BOT_API_TOKEN: "bot-token",
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
        PORT: "8080",
      }).SERVER_PORT,
    ).toBe(8080);
  });

  it("rejects missing bot API token", () => {
    expect(() =>
      loadServerEnv({
        DATABASE_URL: "postgres://habit_gamba:habit_gamba@localhost:5432/habit_gamba",
      }),
    ).toThrow();
  });
});
